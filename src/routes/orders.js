const router = require('express').Router();
const prisma = require('../db');
const { requireAuth, requireCapability } = require('../middleware/auth');
const { uid } = require('../utils/id');
const { needsReferral, referralTarget, generateSpecimenNumber } = require('../utils/domain');
const { logAudit } = require('../utils/audit');

router.use(requireAuth);

// ---------- Visibility rule ----------
// A lab sees an order in full only if it originated there. If the order was referred to this lab,
// only the specific referred test(s) are visible — never the rest of that order. Additionally,
// the granular "interfaced" status is masked as "processing" for anyone but the performing lab —
// pre-validation results are never exposed outside the lab that produced them. Specimens (each a
// physical tube with its own barcode) are filtered the same way — a specimen is only shown if it
// contains at least one test this viewer can see.
function mapOrderForViewer(order, viewerFacilityId) {
  const own = order.orderingFacilityId === viewerFacilityId;
  const tests = order.tests
    .filter(t => own || (t.referred && t.performingFacilityId === viewerFacilityId))
    .map(t => ({
      ...t,
      visibleStatus: (t.status === 'interfaced' && t.performingFacilityId !== viewerFacilityId) ? 'processing' : t.status,
    }));
  const visibleTestIds = new Set(tests.map(t => t.id));
  const specimens = (order.specimens || []).filter(s =>
    (order.tests || []).some(t => t.specimenId === s.id && visibleTestIds.has(t.id))
  );
  return { ...order, tests, specimens, viewerIsOrigin: own };
}

router.get('/', async (req, res) => {
  const fid = req.user.facilityId;
  const { stage } = req.query;

  const orders = await prisma.order.findMany({
    where: { OR: [{ orderingFacilityId: fid }, { tests: { some: { performingFacilityId: fid } } }] },
    include: { tests: true, patient: true, specimens: true },
    orderBy: { createdAt: 'desc' },
  });

  let mapped = orders
    .map(o => mapOrderForViewer(o, fid))
    .filter(o => o.viewerIsOrigin || o.tests.length > 0);

  const stageFilters = {
    pending_collection: o => o.viewerIsOrigin && !o.sampleStatus,
    referral_pending: o => o.viewerIsOrigin && o.tests.some(t => t.status === 'awaiting_referral'),
    pending_acceptance: o => o.viewerIsOrigin && o.tests.some(t => t.status === 'collected'),
    rejected: o => o.viewerIsOrigin && (o.specimens || []).some(s => s.status === 'rejected'),
    incoming_referrals: o => o.tests.some(t => t.referred && t.performingFacilityId === fid && t.status === 'awaiting_receipt'),
    analyser_queue: o => o.tests.some(t => t.performingFacilityId === fid && ['received', 'processing'].includes(t.status)),
    validation_queue: o => o.tests.some(t => t.performingFacilityId === fid && ['received', 'interfaced'].includes(t.status)),
    reportable: o => o.viewerIsOrigin && !!o.sampleStatus,
  };
  if (stage && stageFilters[stage]) mapped = mapped.filter(stageFilters[stage]);

  res.json(mapped);
});

router.get('/:id', async (req, res) => {
  const order = await prisma.order.findUnique({ where: { id: req.params.id }, include: { tests: true, patient: true, specimens: true } });
  if (!order) return res.status(404).json({ error: 'Not found' });
  const mapped = mapOrderForViewer(order, req.user.facilityId);
  if (!mapped.viewerIsOrigin && mapped.tests.length === 0) {
    return res.status(403).json({ error: 'Not visible to this facility' });
  }
  res.json(mapped);
});

// ---------- 1. Memo import (fetch from HIS/Billing) ----------
router.post('/import', requireCapability('collect'), async (req, res) => {
  const { memoNumber } = req.body || {};
  if (!memoNumber) return res.status(400).json({ error: 'memoNumber is required' });

  const existing = await prisma.order.findUnique({ where: { memoNumber }, include: { tests: true, patient: true, specimens: true } });
  if (existing) {
    return res.json(mapOrderForViewer(existing, req.user.facilityId));
  }

  const memo = await prisma.mockHisMemo.findUnique({ where: { memoNumber } });
  if (!memo) return res.status(404).json({ error: `Memo "${memoNumber}" was not found in the HIS/Billing system.` });

  let patient = memo.patientHospitalNumber
    ? await prisma.patient.findFirst({ where: { hospitalNumber: memo.patientHospitalNumber } })
    : null;
  if (!patient) {
    patient = await prisma.patient.create({
      data: {
        id: uid('PT'),
        name: memo.patientName, idNumber: memo.patientIdNumber, hospitalNumber: memo.patientHospitalNumber,
        dob: memo.patientDob, sex: memo.patientSex, address: memo.patientAddress,
        homeFacilityId: req.user.facilityId,
      },
    });
  }

  const testCodes = JSON.parse(memo.testCodes);
  const catalogTests = await prisma.testDefinition.findMany({ where: { code: { in: testCodes } } });

  const order = await prisma.order.create({
    data: {
      id: uid('ORD'),
      memoSource: memo.source, memoNumber: memo.memoNumber,
      patientId: patient.id, orderingFacilityId: req.user.facilityId, orderedBy: memo.orderedBy,
      tests: {
        create: testCodes.map(code => {
          const tc = catalogTests.find(c => c.code === code);
          return { id: uid('OT'), code, name: tc ? tc.name : code, performingFacilityId: req.user.facilityId, status: 'ordered' };
        }),
      },
    },
    include: { tests: true, patient: true, specimens: true },
  });
  await logAudit(req.user, { action: 'memo_imported', entityType: 'Order', entityId: order.id, details: `Fetched memo ${memo.memoNumber} for ${memo.patientName}` });
  res.status(201).json(mapOrderForViewer(order, req.user.facilityId));
});

// Cancel a memo that hasn't been collected yet.
router.delete('/:id', requireCapability('collect'), async (req, res) => {
  const order = await prisma.order.findUnique({ where: { id: req.params.id } });
  if (!order) return res.status(404).json({ error: 'Not found' });
  if (order.orderingFacilityId !== req.user.facilityId) return res.status(403).json({ error: "Not this facility's order" });
  if (order.sampleStatus) return res.status(409).json({ error: 'Cannot cancel — already collected' });
  await prisma.orderTest.deleteMany({ where: { orderId: order.id } });
  await prisma.order.delete({ where: { id: order.id } });
  await logAudit(req.user, { action: 'memo_cancelled', entityType: 'Order', entityId: order.id, details: `Cancelled memo ${order.memoNumber}` });
  res.json({ ok: true });
});

// ---------- 2. Sample Collection (select tests, generate one barcode per specimen bottle) ----------
router.post('/:id/collect', requireCapability('collect'), async (req, res) => {
  const { id } = req.params;
  const { selectedCodes } = req.body || {};
  const collectedBy = req.user.name; // the logged-in technologist collecting — not client-supplied

  const order = await prisma.order.findUnique({ where: { id }, include: { tests: true } });
  if (!order) return res.status(404).json({ error: 'Not found' });
  if (order.orderingFacilityId !== req.user.facilityId) return res.status(403).json({ error: "Not this facility's order" });
  if (order.sampleStatus) return res.status(409).json({ error: 'Already collected' });

  const facility = await prisma.facility.findUnique({ where: { id: req.user.facilityId } });
  const catalogTests = await prisma.testDefinition.findMany({ where: { code: { in: order.tests.map(t => t.code) } } });
  const categories = await prisma.testCategory.findMany();
  const letterFor = (categoryName) => {
    const match = categories.find(c => c.name === categoryName);
    return match ? match.letter : (categoryName || 'X').trim().charAt(0).toUpperCase() || 'X';
  };

  await prisma.order.update({
    where: { id },
    data: { sampleStatus: 'collected', collectedAt: new Date(), collectedBy },
  });

  const selected = new Set(selectedCodes || []);

  // One Specimen (one barcode) per distinct (category, bottle type) pair among the selected tests —
  // a department (e.g. Serology) gets its own tube/barcode even if it happens to share a bottle
  // type with another department (e.g. Biochemistry), since acceptance and the analyzer interface
  // both operate at this level.
  const groups = {}; // "category||bottleType" -> { category, bottleType, tests:[OrderTest,...] }
  order.tests.forEach(t => {
    if (!selected.has(t.code)) return;
    const tc = catalogTests.find(c => c.code === t.code);
    const category = (tc && tc.category && tc.category.trim()) ? tc.category.trim() : 'General';
    const bottleType = (tc && tc.specimenType && tc.specimenType.trim()) ? tc.specimenType.trim() : 'Unspecified Specimen';
    const key = `${category}||${bottleType}`;
    (groups[key] = groups[key] || { category, bottleType, tests: [] }).tests.push(t);
  });

  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dailySeq = {}; // category -> running count for today, fetched once per category then incremented in-process

  for (const key of Object.keys(groups)) {
    const { category, bottleType, tests } = groups[key];
    if (dailySeq[category] === undefined) {
      dailySeq[category] = await prisma.specimen.count({ where: { category, createdAt: { gte: startOfDay } } });
    }
    dailySeq[category] += 1;
    const specimenNumber = generateSpecimenNumber(letterFor(category), dailySeq[category], now);

    const specimen = await prisma.specimen.create({
      data: { id: uid('SPC'), specimenNumber, orderId: id, category, bottleType, status: 'collected', collectedAt: now, collectedBy },
    });
    await Promise.all(tests.map(t => {
      const tc = catalogTests.find(c => c.code === t.code);
      const needsRef = tc ? needsReferral(tc, facility) : false;
      // Higher-level tests go straight to "ready to refer" here at collection — referral is
      // assigned and sent from Sample Collection, not later. Local tests await acceptance as usual.
      return prisma.orderTest.update({
        where: { id: t.id },
        data: { status: needsRef ? 'awaiting_referral' : 'collected', needsReferral: needsRef, specimenId: specimen.id },
      });
    }));
  }

  // Deselected tests stay on the order (audit trail) but belong to no specimen — nothing was drawn.
  await Promise.all(order.tests.filter(t => !selected.has(t.code)).map(t =>
    prisma.orderTest.update({ where: { id: t.id }, data: { status: 'deselected' } })
  ));

  const full = await prisma.order.findUnique({ where: { id }, include: { tests: true, patient: true, specimens: true } });
  await logAudit(req.user, { action: 'collect', entityType: 'Order', entityId: id, details: `Collected memo ${order.memoNumber} — ${full.specimens.length} specimen(s)` });
  res.json(mapOrderForViewer(full, req.user.facilityId));
});

// Redraw specimens for tests that were rejected at acceptance. The order's own collectedAt/
// collectedBy (the very first draw for this memo) never changes — only the new specimen(s) get a
// fresh collection timestamp and collector, same as a normal collect, tracked per-specimen.
router.post('/:id/recollect', requireCapability('collect'), async (req, res) => {
  const { id } = req.params;
  const { testCodes } = req.body || {};
  const collectedBy = req.user.name;
  if (!testCodes || !testCodes.length) return res.status(400).json({ error: 'testCodes is required' });

  const order = await prisma.order.findUnique({ where: { id }, include: { tests: true } });
  if (!order) return res.status(404).json({ error: 'Not found' });
  if (order.orderingFacilityId !== req.user.facilityId) return res.status(403).json({ error: "Not this facility's order" });

  const targetTests = order.tests.filter(t => testCodes.includes(t.code) && t.status === 'rejected');
  if (!targetTests.length) return res.status(409).json({ error: 'None of the given tests are currently rejected.' });

  const facility = await prisma.facility.findUnique({ where: { id: req.user.facilityId } });
  const catalogTests = await prisma.testDefinition.findMany({ where: { code: { in: targetTests.map(t => t.code) } } });
  const categories = await prisma.testCategory.findMany();
  const letterFor = (categoryName) => {
    const match = categories.find(c => c.name === categoryName);
    return match ? match.letter : (categoryName || 'X').trim().charAt(0).toUpperCase() || 'X';
  };

  const groups = {};
  targetTests.forEach(t => {
    const tc = catalogTests.find(c => c.code === t.code);
    const category = (tc && tc.category && tc.category.trim()) ? tc.category.trim() : 'General';
    const bottleType = (tc && tc.specimenType && tc.specimenType.trim()) ? tc.specimenType.trim() : 'Unspecified Specimen';
    const key = `${category}||${bottleType}`;
    (groups[key] = groups[key] || { category, bottleType, tests: [] }).tests.push(t);
  });

  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dailySeq = {};

  for (const key of Object.keys(groups)) {
    const { category, bottleType, tests } = groups[key];
    if (dailySeq[category] === undefined) {
      dailySeq[category] = await prisma.specimen.count({ where: { category, createdAt: { gte: startOfDay } } });
    }
    dailySeq[category] += 1;
    const specimenNumber = generateSpecimenNumber(letterFor(category), dailySeq[category], now);

    // A brand-new specimen row — the old rejected one stays in place, untouched, as the record of
    // what happened to the original draw.
    const specimen = await prisma.specimen.create({
      data: { id: uid('SPC'), specimenNumber, orderId: id, category, bottleType, status: 'collected', collectedAt: now, collectedBy },
    });
    await Promise.all(tests.map(t => {
      const tc = catalogTests.find(c => c.code === t.code);
      const needsRef = tc ? needsReferral(tc, facility) : false;
      return prisma.orderTest.update({
        where: { id: t.id },
        data: { status: needsRef ? 'awaiting_referral' : 'collected', needsReferral: needsRef, specimenId: specimen.id },
      });
    }));
  }

  const full = await prisma.order.findUnique({ where: { id }, include: { tests: true, patient: true, specimens: true } });
  await logAudit(req.user, { action: 'recollect', entityType: 'Order', entityId: id, details: `Recollected rejected test(s) for memo ${order.memoNumber}` });
  res.json(mapOrderForViewer(full, req.user.facilityId));
});

// ---------- 3. Referral (assigned and sent from Collection) ----------
router.post('/:id/refer', requireCapability('collect'), async (req, res) => {
  const { id } = req.params;
  const referredByName = req.user.name; // who's logged in and clicked Refer — not client-supplied

  const order = await prisma.order.findUnique({ where: { id }, include: { tests: true } });
  if (!order) return res.status(404).json({ error: 'Not found' });
  if (order.orderingFacilityId !== req.user.facilityId) return res.status(403).json({ error: "Not this facility's order" });

  const facilities = await prisma.facility.findMany();
  const originFacility = facilities.find(f => f.id === order.orderingFacilityId);
  const catalogTests = await prisma.testDefinition.findMany({ where: { code: { in: order.tests.map(t => t.code) } } });

  const targetNames = new Set();
  for (const t of order.tests) {
    if (t.status !== 'awaiting_referral') continue;
    const tc = catalogTests.find(c => c.code === t.code);
    const target = referralTarget(tc, originFacility, facilities);
    if (!target) continue;
    await prisma.orderTest.update({
      where: { id: t.id },
      data: { referred: true, performingFacilityId: target.id, status: 'awaiting_receipt', referredByName },
    });
    targetNames.add(target.name);
  }

  // If nothing local remains (everything on this sample was referred), the referred specimen(s)
  // never entered 'collected' locally — nothing further to do at the order level.
  await prisma.order.update({ where: { id }, data: { referredAt: new Date(), referredByName } });

  const full = await prisma.order.findUnique({ where: { id }, include: { tests: true, patient: true, specimens: true } });
  await logAudit(req.user, { action: 'refer', entityType: 'Order', entityId: id, details: `Referred memo ${order.memoNumber} to ${Array.from(targetNames).join(' & ')}` });
  res.json({ order: mapOrderForViewer(full, req.user.facilityId), referredTo: Array.from(targetNames) });
});

// ---------- 4. Sample Acceptance moved to specimens.js — accept/reject is per specimen now ----------

// ---------- 5. Incoming referrals (receiving facility) ----------
router.post('/:id/receive-referral', requireCapability('process'), async (req, res) => {
  const { id } = req.params;
  await prisma.orderTest.updateMany({
    where: { orderId: id, referred: true, performingFacilityId: req.user.facilityId, status: 'awaiting_receipt' },
    data: { status: 'received' },
  });
  const full = await prisma.order.findUnique({ where: { id }, include: { tests: true, patient: true, specimens: true } });
  if (!full) return res.status(404).json({ error: 'Not found' });
  await logAudit(req.user, { action: 'receive_referral', entityType: 'Order', entityId: id, details: `Received referred sample for memo ${full.memoNumber}` });
  res.json(mapOrderForViewer(full, req.user.facilityId));
});

module.exports = router;
