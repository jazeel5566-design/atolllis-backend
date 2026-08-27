const router = require('express').Router();
const prisma = require('../db');
const { requireAuth, requireCapability } = require('../middleware/auth');

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
    data: { value: String(value), unit, status: 'interfaced', enteredAt: new Date(), enteredBy: 'Analyser Interface' },
  });
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
    data: { value: String(value), unit: tc ? tc.units : null, status: 'interfaced', enteredAt: new Date(), enteredBy: 'Manual Entry' },
  });
  res.json(updated);
});

// Validate & certify — done only by the facility that actually performed the test.
router.post('/:orderId/:code/certify', requireCapability('certify'), async (req, res) => {
  const { orderId, code } = req.params;
  const validatedBy = req.user.name; // the certifying pathologist/lab manager — not client-supplied

  const t = await prisma.orderTest.findFirst({ where: { orderId, code } });
  if (!t || t.performingFacilityId !== req.user.facilityId) return res.status(404).json({ error: 'Not found' });
  if (t.status !== 'interfaced') return res.status(409).json({ error: `Test is not awaiting validation (status: ${t.status})` });

  const updated = await prisma.orderTest.update({
    where: { id: t.id },
    data: { status: 'completed', validatedBy, validatedAt: new Date() },
  });
  res.json(updated);
});

module.exports = router;
