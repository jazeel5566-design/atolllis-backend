const router = require('express').Router();
const prisma = require('../db');
const { requireAuth, requireCapability } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');
const { uid } = require('../utils/id');
const { resolveRejectionReason } = require('../utils/rejection');

router.use(requireAuth);

// Writes the structured record of one rejection decision. `resolved` comes from
// resolveRejectionReason(); the facility name is snapshotted the same way the audit log does it.
async function recordRejection(specimen, user, resolved) {
  const facility = await prisma.facility.findUnique({ where: { id: user.facilityId }, select: { name: true } });
  return prisma.specimenRejection.create({
    data: {
      id: uid('REJ'), specimenId: specimen.id,
      facilityId: user.facilityId, facilityName: facility ? facility.name : 'Unknown',
      reasonId: resolved.reasonId, reasonName: resolved.reasonName, note: resolved.note,
      category: specimen.category, rejectedBy: user.name,
    },
  });
}

function parseDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Sample Rejection Log + the data behind its summary table. A facility sees the rejections it made
// itself, plus rejections made by a receiving lab on specimens it ordered — never anyone else's.
// Optional ?from=&to= (ISO timestamps) bound the period. Specimens rejected before SpecimenRejection
// existed have no row there; they're included from the Specimen itself so the log stays complete.
router.get('/rejections', async (req, res) => {
  const fid = req.user.facilityId;
  const from = parseDate(req.query.from);
  const to = parseDate(req.query.to);
  const inRange = d => (!from || d >= from) && (!to || d <= to);
  const withOrder = { order: { include: { patient: true, orderingFacility: { select: { name: true } } } } };

  const recorded = await prisma.specimenRejection.findMany({
    where: {
      OR: [{ facilityId: fid }, { specimen: { order: { orderingFacilityId: fid } } }],
      ...(from || to ? { rejectedAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    },
    include: { specimen: { include: withOrder } },
  });
  const legacy = await prisma.specimen.findMany({
    where: { status: 'rejected', rejections: { none: {} }, order: { orderingFacilityId: fid } },
    include: withOrder,
  });

  const describe = (specimen) => ({
    specimenNumber: specimen.specimenNumber,
    bottleType: specimen.bottleType,
    orderId: specimen.orderId,
    memoNumber: specimen.order.memoNumber,
    orderingFacilityId: specimen.order.orderingFacilityId,
    orderingFacilityName: specimen.order.orderingFacility.name,
    patient: { name: specimen.order.patient.name, hospitalNumber: specimen.order.patient.hospitalNumber },
  });

  const rows = [
    ...recorded.map(r => ({
      id: r.id, ...describe(r.specimen), category: r.category,
      reasonId: r.reasonId, reasonName: r.reasonName, note: r.note,
      facilityId: r.facilityId, facilityName: r.facilityName,
      rejectedBy: r.rejectedBy, rejectedAt: r.rejectedAt,
    })),
    ...legacy
      .map(s => ({
        id: s.id, ...describe(s), category: s.category,
        reasonId: null, reasonName: s.rejectionReason || 'Not specified', note: null,
        facilityId: s.order.orderingFacilityId, facilityName: s.order.orderingFacility.name,
        rejectedBy: s.acceptedBy, rejectedAt: s.acceptedAt || s.createdAt,
      }))
      .filter(r => inRange(r.rejectedAt)),
  ].sort((a, b) => new Date(b.rejectedAt) - new Date(a.rejectedAt));

  res.json(rows);
});

// Only the tests on THIS specimen that a given viewer is entitled to see: the ordering facility
// sees everything on its own specimen; any other facility sees only what it actually performs.
// The granular "interfaced" status is still masked as "processing" for anyone but the performer —
// this mirrors an analyzer reading one tube's barcode and seeing only what's on that tube.
function visibleTestsForSpecimen(specimen, viewerFacilityId, isOrigin) {
  return specimen.order.tests
    .filter(t => t.specimenId === specimen.id && (isOrigin || t.performingFacilityId === viewerFacilityId))
    .map(t => ({
      ...t,
      visibleStatus: (t.status === 'interfaced' && t.performingFacilityId !== viewerFacilityId) ? 'processing' : t.status,
    }));
}

// Look up a specimen by its printed barcode number — this is the "scan the tube" action. Used by
// both Sample Acceptance (to accept/reject) and Analyser Processing (to load/report results).
router.get('/:specimenNumber', async (req, res) => {
  const specimen = await prisma.specimen.findUnique({
    where: { specimenNumber: req.params.specimenNumber },
    include: { order: { include: { tests: true, patient: true, ward: true } } },
  });
  if (!specimen) return res.status(404).json({ error: 'No specimen found with that barcode number.' });

  const isOrigin = specimen.order.orderingFacilityId === req.user.facilityId;
  const tests = visibleTestsForSpecimen(specimen, req.user.facilityId, isOrigin);
  if (!tests.length) return res.status(403).json({ error: 'This specimen has no tests assigned to your facility.' });

  // The patient's last certified result for each test, for comparison at validation — drawn only
  // from results this facility could already see: its own orders, and tests it performed.
  const fid = req.user.facilityId;
  const earlier = await prisma.orderTest.findMany({
    where: {
      code: { in: tests.map(t => t.code) }, status: 'completed', orderId: { not: specimen.orderId },
      order: { patientId: specimen.order.patientId },
      OR: [{ performingFacilityId: fid }, { order: { orderingFacilityId: fid } }],
    },
    orderBy: { validatedAt: 'desc' },
  });
  for (const t of tests) {
    const prev = earlier.find(e => e.code === t.code);
    t.previous = prev ? { value: prev.value, unit: prev.unit, validatedAt: prev.validatedAt } : null;
  }

  res.json({
    specimenNumber: specimen.specimenNumber,
    category: specimen.category,
    bottleType: specimen.bottleType,
    status: specimen.status,
    rejectionReason: specimen.rejectionReason,
    orderId: specimen.orderId,
    memoNumber: specimen.order.memoNumber,
    orderedBy: specimen.order.orderedBy,
    patientType: specimen.order.patientType,
    wardName: specimen.order.ward ? specimen.order.ward.name : null,
    collectedAt: specimen.collectedAt,
    isOrigin,
    patient: specimen.order.patient,
    tests,
  });
});

// Load this one tube to the analyser — only the tests on it, only if this facility performs them,
// only if they're actually waiting ('received'). This is the "analyzer reads the barcode and
// decides which tests to run" step.
router.post('/:specimenNumber/load-analyser', requireCapability('process'), async (req, res) => {
  const specimen = await prisma.specimen.findUnique({
    where: { specimenNumber: req.params.specimenNumber },
    include: { order: { include: { tests: true } } },
  });
  if (!specimen) return res.status(404).json({ error: 'No specimen found with that barcode number.' });

  const toLoad = specimen.order.tests.filter(t =>
    t.specimenId === specimen.id && t.performingFacilityId === req.user.facilityId && t.status === 'received'
  );
  if (!toLoad.length) return res.status(409).json({ error: 'Nothing on this specimen is awaiting the analyser.' });

  await prisma.orderTest.updateMany({
    where: { id: { in: toLoad.map(t => t.id) } },
    data: { status: 'processing' },
  });
  await logAudit(req.user, { action: 'load_analyser', entityType: 'Specimen', entityId: specimen.id, details: `Loaded specimen ${specimen.specimenNumber} to analyser — ${toLoad.length} test(s)` });

  const refreshed = await prisma.specimen.findUnique({
    where: { id: specimen.id },
    include: { order: { include: { tests: true, patient: true } } },
  });
  res.json({
    specimenNumber: refreshed.specimenNumber,
    category: refreshed.category,
    bottleType: refreshed.bottleType,
    orderId: refreshed.orderId,
    memoNumber: refreshed.order.memoNumber,
    patient: refreshed.order.patient,
    tests: visibleTestsForSpecimen(refreshed, req.user.facilityId, refreshed.order.orderingFacilityId === req.user.facilityId),
  });
});

// Accept this one specimen (one tube, one department) into the lab — only the ordering facility
// can decide this, and only for tests still awaiting the decision ('collected').
router.post('/:specimenNumber/accept', requireCapability('accept'), async (req, res) => {
  const acceptedBy = req.user.name; // who's logged in and clicked Accept — not client-supplied

  const specimen = await prisma.specimen.findUnique({ where: { specimenNumber: req.params.specimenNumber }, include: { order: true } });
  if (!specimen) return res.status(404).json({ error: 'No specimen found with that barcode number.' });
  if (specimen.order.orderingFacilityId !== req.user.facilityId) return res.status(403).json({ error: "Not this facility's specimen" });
  if (specimen.status !== 'collected') return res.status(409).json({ error: `Specimen is already ${specimen.status}` });

  await prisma.specimen.update({ where: { id: specimen.id }, data: { status: 'received', acceptedAt: new Date(), acceptedBy } });
  await prisma.orderTest.updateMany({ where: { specimenId: specimen.id, status: 'collected' }, data: { status: 'received' } });
  await logAudit(req.user, { action: 'accept', entityType: 'Specimen', entityId: specimen.id, details: `Accepted specimen ${specimen.specimenNumber} (${specimen.category})` });

  const refreshed = await prisma.specimen.findUnique({ where: { id: specimen.id }, include: { order: { include: { tests: true, patient: true } } } });
  res.json({
    specimenNumber: refreshed.specimenNumber, category: refreshed.category, bottleType: refreshed.bottleType, status: refreshed.status,
    orderId: refreshed.orderId, memoNumber: refreshed.order.memoNumber, patient: refreshed.order.patient,
    tests: refreshed.order.tests.filter(t => t.specimenId === refreshed.id),
  });
});

router.post('/:specimenNumber/reject', requireCapability('accept'), async (req, res) => {
  const resolved = await resolveRejectionReason(req.body);
  if (resolved.error) return res.status(400).json({ error: resolved.error });

  const specimen = await prisma.specimen.findUnique({ where: { specimenNumber: req.params.specimenNumber }, include: { order: true } });
  if (!specimen) return res.status(404).json({ error: 'No specimen found with that barcode number.' });
  if (specimen.order.orderingFacilityId !== req.user.facilityId) return res.status(403).json({ error: "Not this facility's specimen" });
  if (specimen.status !== 'collected') return res.status(409).json({ error: `Specimen is already ${specimen.status}` });

  // Specimen.rejectionReason keeps the readable text for display; who/when/which-reason live on the
  // SpecimenRejection row (acceptedBy/acceptedAt are no longer borrowed for a rejection).
  await prisma.specimen.update({ where: { id: specimen.id }, data: { status: 'rejected', rejectionReason: resolved.text } });
  await prisma.orderTest.updateMany({ where: { specimenId: specimen.id, status: 'collected' }, data: { status: 'rejected' } });
  const rejection = await recordRejection(specimen, req.user, resolved);
  await logAudit(req.user, { action: 'reject', entityType: 'Specimen', entityId: specimen.id, details: `Rejected specimen ${specimen.specimenNumber} (${specimen.category}) — ${resolved.text}` });

  const refreshed = await prisma.specimen.findUnique({ where: { id: specimen.id }, include: { order: { include: { tests: true, patient: true } } } });
  res.json({
    specimenNumber: refreshed.specimenNumber, category: refreshed.category, bottleType: refreshed.bottleType, status: refreshed.status,
    rejectionReason: refreshed.rejectionReason, rejectedBy: rejection.rejectedBy,
    orderId: refreshed.orderId, memoNumber: refreshed.order.memoNumber, patient: refreshed.order.patient,
    tests: refreshed.order.tests.filter(t => t.specimenId === refreshed.id),
  });
});

// ---------- Referred specimens, at the receiving lab ----------
// The tests on this tube that were referred to the caller's facility and haven't been decided yet.
function awaitingReceiptHere(specimen, facilityId) {
  return specimen.order.tests.filter(t =>
    t.specimenId === specimen.id && t.referred && t.performingFacilityId === facilityId && t.status === 'awaiting_receipt'
  );
}

// Receive one referred tube — the per-specimen version of POST /api/orders/:id/receive-referral.
router.post('/:specimenNumber/receive-referral', requireCapability('process'), async (req, res) => {
  const specimen = await prisma.specimen.findUnique({
    where: { specimenNumber: req.params.specimenNumber },
    include: { order: { include: { tests: true } } },
  });
  if (!specimen) return res.status(404).json({ error: 'No specimen found with that barcode number.' });

  const toReceive = awaitingReceiptHere(specimen, req.user.facilityId);
  if (!toReceive.length) return res.status(409).json({ error: 'Nothing on this specimen is awaiting receipt at your facility.' });

  await prisma.orderTest.updateMany({ where: { id: { in: toReceive.map(t => t.id) } }, data: { status: 'received' } });
  await logAudit(req.user, { action: 'receive_referral', entityType: 'Specimen', entityId: specimen.id, details: `Received referred specimen ${specimen.specimenNumber} for memo ${specimen.order.memoNumber}` });
  res.json({ specimenNumber: specimen.specimenNumber, received: toReceive.length });
});

// Reject a referred tube on arrival. Only the tests referred to this lab are affected — anything
// else on the same tube (tests the ordering facility performs itself) carries on untouched. The
// rejected tests are handed back to the ordering facility as 'rejected', exactly as if it had
// rejected them itself, so its existing Recollect → Refer flow issues a new barcode and sends
// them again.
router.post('/:specimenNumber/reject-referral', requireCapability('accept'), async (req, res) => {
  const resolved = await resolveRejectionReason(req.body);
  if (resolved.error) return res.status(400).json({ error: resolved.error });

  const specimen = await prisma.specimen.findUnique({
    where: { specimenNumber: req.params.specimenNumber },
    include: { order: { include: { tests: true } } },
  });
  if (!specimen) return res.status(404).json({ error: 'No specimen found with that barcode number.' });

  const toReject = awaitingReceiptHere(specimen, req.user.facilityId);
  if (!toReject.length) return res.status(409).json({ error: 'Nothing on this specimen is awaiting receipt at your facility.' });

  const rejectedIds = new Set(toReject.map(t => t.id));
  await prisma.orderTest.updateMany({
    where: { id: { in: toReject.map(t => t.id) } },
    data: { status: 'rejected', referred: false, performingFacilityId: specimen.order.orderingFacilityId },
  });
  // The tube itself is only marked rejected once nothing on it is still in play.
  const stillActive = specimen.order.tests.some(t =>
    t.specimenId === specimen.id && !rejectedIds.has(t.id) && !['rejected', 'deselected'].includes(t.status)
  );
  if (!stillActive) {
    await prisma.specimen.update({ where: { id: specimen.id }, data: { status: 'rejected', rejectionReason: resolved.text } });
  }
  const rejection = await recordRejection(specimen, req.user, resolved);
  await logAudit(req.user, { action: 'reject_referral', entityType: 'Specimen', entityId: specimen.id, details: `Rejected referred specimen ${specimen.specimenNumber} (${specimen.category}) for memo ${specimen.order.memoNumber} — ${resolved.text}` });

  res.json({ specimenNumber: specimen.specimenNumber, rejected: toReject.length, rejectionReason: resolved.text, rejectedBy: rejection.rejectedBy });
});

module.exports = router;
