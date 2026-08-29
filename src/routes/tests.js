const router = require('express').Router();
const prisma = require('../db');
const { requireAuth, requireCapability } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');
const { uid } = require('../utils/id');
const { evalResult } = require('../utils/domain');

router.use(requireAuth);

// Simulated bidirectional interface: the LIS only accepts a result from the analyser if its unit
// matches the unit defined for that test in the catalog.
router.post('/:orderId/:code/analyser-result', requireCapability('process'), async (req, res) => {
  const { orderId, code } = req.params;
  const { value, unit } = req.body || {};
  if (value === undefined || value === '' || !unit) return res.status(400).json({ error: 'value and unit are required' });

  const t = await prisma.orderTest.findFirst({ where: { orderId, code } });
  if (!t || t.performingFacilityId !== req.user.facilityId) return res.status(404).json({ error: 'Not found' });
  if (t.status !== 'processing') return res.status(409).json({ error: `Test is not loaded to the analyser (status: ${t.status})` });

  const tc = await prisma.testDefinition.findUnique({ where: { code } });
  if (!tc) return res.status(404).json({ error: 'Unknown test code' });
  if (String(unit).toLowerCase() !== String(tc.units || '').toLowerCase()) {
    return res.status(422).json({ error: `Unit mismatch: analyser sent "${unit}", LIS expects "${tc.units}". Result not accepted.` });
  }

  const updated = await prisma.orderTest.update({
    where: { id: t.id },
    data: { value: String(value), unit, status: 'interfaced', enteredAt: new Date(), enteredBy: req.user.name },
  });
  await logAudit(req.user, { action: 'analyser_result', entityType: 'OrderTest', entityId: t.id, details: `${code}: ${value} ${unit} (from analyser)` });
  res.json(updated);
});

// Manual entry path (skips the analyser) — unit is fixed to the catalog default, so no mismatch is possible.
router.post('/:orderId/:code/manual-result', requireCapability('process'), async (req, res) => {
  const { orderId, code } = req.params;
  const { value } = req.body || {};
  if (value === undefined || value === '') return res.status(400).json({ error: 'value is required' });

  const t = await prisma.orderTest.findFirst({ where: { orderId, code } });
  if (!t || t.performingFacilityId !== req.user.facilityId) return res.status(404).json({ error: 'Not found' });
  if (t.status !== 'received') return res.status(409).json({ error: `Test is not awaiting manual entry (status: ${t.status})` });

  const tc = await prisma.testDefinition.findUnique({ where: { code } });
  const updated = await prisma.orderTest.update({
    where: { id: t.id },
    data: { value: String(value), unit: tc ? tc.units : null, status: 'interfaced', enteredAt: new Date(), enteredBy: req.user.name },
  });
  await logAudit(req.user, { action: 'manual_result', entityType: 'OrderTest', entityId: t.id, details: `${code}: ${value} (manual entry)` });
  res.json(updated);
});

// Culture & sensitivity result — the structured alternative to a plain value, used for tests where
// TestDefinition.isCulture is true. Growth status, then zero or more organisms found, each with
// its own antibiotic sensitivity panel (S/I/R).
router.get('/:orderId/:code/culture-result', requireCapability('process'), async (req, res) => {
  const { orderId, code } = req.params;
  const t = await prisma.orderTest.findFirst({ where: { orderId, code } });
  if (!t || t.performingFacilityId !== req.user.facilityId) return res.status(404).json({ error: 'Not found' });
  const result = await prisma.cultureResult.findUnique({
    where: { orderTestId: t.id },
    include: { organisms: { include: { organism: true, sensitivities: { include: { antibiotic: true } } } } },
  });
  res.json(result);
});

router.post('/:orderId/:code/culture-result', requireCapability('process'), async (req, res) => {
  const { orderId, code } = req.params;
  const { growthStatus, organisms } = req.body || {};
  if (!['no_growth', 'growth', 'contaminated'].includes(growthStatus)) {
    return res.status(400).json({ error: 'growthStatus must be no_growth, growth, or contaminated' });
  }
  if (growthStatus === 'growth' && (!Array.isArray(organisms) || !organisms.length)) {
    return res.status(400).json({ error: 'At least one organism is required when growthStatus is "growth"' });
  }

  const t = await prisma.orderTest.findFirst({ where: { orderId, code } });
  if (!t || t.performingFacilityId !== req.user.facilityId) return res.status(404).json({ error: 'Not found' });
  if (t.status !== 'received') return res.status(409).json({ error: `Test is not awaiting entry (status: ${t.status})` });

  // Replace any previous attempt cleanly rather than trying to diff it.
  const existing = await prisma.cultureResult.findUnique({ where: { orderTestId: t.id } });
  if (existing) await prisma.cultureResult.delete({ where: { id: existing.id } });

  const cultureResult = await prisma.cultureResult.create({
    data: {
      id: uid('CULT'), orderTestId: t.id, growthStatus,
      organisms: {
        create: (organisms || []).map(o => ({
          id: uid('OF'), organismId: o.organismId, colonyCount: o.colonyCount || null,
          sensitivities: {
            create: (o.sensitivities || []).filter(s => ['S', 'I', 'R'].includes(s.result)).map(s => ({
              id: uid('AS'), antibioticId: s.antibioticId, result: s.result,
            })),
          },
        })),
      },
    },
    include: { organisms: { include: { organism: true, sensitivities: { include: { antibiotic: true } } } } },
  });

  const summary = growthStatus === 'no_growth' ? 'No growth'
    : growthStatus === 'contaminated' ? 'Contaminated specimen'
    : `Growth: ${cultureResult.organisms.map(o => o.organism.name).join(', ')}`;

  const updated = await prisma.orderTest.update({
    where: { id: t.id },
    data: { value: summary, status: 'interfaced', enteredAt: new Date(), enteredBy: req.user.name },
  });
  await logAudit(req.user, { action: 'culture_result', entityType: 'OrderTest', entityId: t.id, details: `${code}: ${summary}` });
  res.json({ ...updated, cultureResult });
});

// Validate & certify — done only by the facility that actually performed the test.
router.post('/:orderId/:code/certify', requireCapability('certify'), async (req, res) => {
  const { orderId, code } = req.params;
  const { criticalNotifiedTo } = req.body || {};
  const validatedBy = req.user.name; // the certifying pathologist/lab manager — not client-supplied

  const t = await prisma.orderTest.findFirst({ where: { orderId, code } });
  if (!t || t.performingFacilityId !== req.user.facilityId) return res.status(404).json({ error: 'Not found' });
  if (t.status !== 'interfaced') return res.status(409).json({ error: `Test is not awaiting validation (status: ${t.status})` });

  // A critical (panic) value cannot be certified until whoever entered/validated it confirms the
  // ordering clinician was actually told — this is a real patient-safety requirement, not paperwork.
  const tc = await prisma.testDefinition.findUnique({ where: { code }, include: { refRanges: true } });
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { patient: true } });
  const info = tc && order ? evalResult(tc, order.patient, t.value) : { flag: 'N/A' };
  const isCritical = info.flag === 'CriticalLow' || info.flag === 'CriticalHigh';
  if (isCritical && !criticalNotifiedTo) {
    return res.status(400).json({ error: 'This is a critical value — enter who was notified before certifying.', requiresCriticalNotification: true, flag: info.flag, flagLabel: info.flagLabel });
  }

  const updated = await prisma.orderTest.update({
    where: { id: t.id },
    data: {
      status: 'completed', validatedBy, validatedAt: new Date(),
      ...(isCritical ? { criticalNotifiedTo, criticalNotifiedAt: new Date() } : {}),
    },
  });
  await logAudit(req.user, { action: 'certify', entityType: 'OrderTest', entityId: t.id, details: `${code}: ${t.value} — certified${isCritical ? ` (critical value, notified ${criticalNotifiedTo})` : ''}` });

  // Reflex suggestions — never auto-ordered. Just surfaced here for the certifying staff to act
  // on with one click if they agree; adding one still requires a real specimen draw afterward,
  // same as any other test.
  let reflexSuggestions = [];
  const numericValue = parseFloat(updated.value);
  if (!Number.isNaN(numericValue)) {
    const rules = await prisma.reflexRule.findMany({ where: { triggerTestCode: code, enabled: true } });
    const matched = rules.filter(r => {
      switch (r.condition) {
        case '>': return numericValue > r.thresholdValue;
        case '<': return numericValue < r.thresholdValue;
        case '>=': return numericValue >= r.thresholdValue;
        case '<=': return numericValue <= r.thresholdValue;
        case '==': return numericValue === r.thresholdValue;
        default: return false;
      }
    });
    if (matched.length) {
      const resultCodes = matched.map(r => r.resultTestCode);
      const [alreadyOnOrder, resultTests] = await Promise.all([
        prisma.orderTest.findMany({ where: { orderId, code: { in: resultCodes } } }),
        prisma.testDefinition.findMany({ where: { code: { in: resultCodes } } }),
      ]);
      reflexSuggestions = matched
        .filter(r => !alreadyOnOrder.some(t2 => t2.code === r.resultTestCode)) // don't suggest something already on the order
        .map(r => {
          const rt = resultTests.find(x => x.code === r.resultTestCode);
          return { ruleId: r.id, name: r.name, resultTestCode: r.resultTestCode, resultTestName: rt ? rt.name : r.resultTestCode, reason: `${code} ${r.condition} ${r.thresholdValue}` };
        });
    }
  }

  res.json({ ...updated, reflexSuggestions });
});

// Adds a reflex-suggested test to an already-existing order, as a fresh 'ordered' test — it still
// needs a real specimen collected for it afterward, same as any other test on the order.
router.post('/:orderId/add-reflex-test', requireCapability('collect'), async (req, res) => {
  const { orderId } = req.params;
  const { code } = req.body || {};
  if (!code) return res.status(400).json({ error: 'code is required' });

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) return res.status(404).json({ error: 'Not found' });
  if (order.orderingFacilityId !== req.user.facilityId) return res.status(403).json({ error: "Not this facility's order" });

  const existing = await prisma.orderTest.findFirst({ where: { orderId, code } });
  if (existing) return res.status(409).json({ error: 'This test is already on the order' });

  const tc = await prisma.testDefinition.findUnique({ where: { code } });
  if (!tc) return res.status(404).json({ error: 'Unknown test code' });

  const newTest = await prisma.orderTest.create({
    data: { id: uid('OT'), orderId, code, name: tc.name, performingFacilityId: req.user.facilityId, status: 'ordered' },
  });
  await logAudit(req.user, { action: 'reflex_test_added', entityType: 'OrderTest', entityId: newTest.id, details: `Added ${code} (${tc.name}) via reflex rule to order ${order.memoNumber}` });
  res.status(201).json(newTest);
});

module.exports = router;
