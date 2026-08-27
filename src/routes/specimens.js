const router = require('express').Router();
const prisma = require('../db');
const { requireAuth, requireCapability } = require('../middleware/auth');

router.use(requireAuth);

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
    include: { order: { include: { tests: true, patient: true } } },
  });
  if (!specimen) return res.status(404).json({ error: 'No specimen found with that barcode number.' });

  const isOrigin = specimen.order.orderingFacilityId === req.user.facilityId;
  const tests = visibleTestsForSpecimen(specimen, req.user.facilityId, isOrigin);
  if (!tests.length) return res.status(403).json({ error: 'This specimen has no tests assigned to your facility.' });

  res.json({
    specimenNumber: specimen.specimenNumber,
    category: specimen.category,
    bottleType: specimen.bottleType,
    status: specimen.status,
    rejectionReason: specimen.rejectionReason,
    orderId: specimen.orderId,
    memoNumber: specimen.order.memoNumber,
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

  const refreshed = await prisma.specimen.findUnique({ where: { id: specimen.id }, include: { order: { include: { tests: true, patient: true } } } });
  res.json({
    specimenNumber: refreshed.specimenNumber, category: refreshed.category, bottleType: refreshed.bottleType, status: refreshed.status,
    orderId: refreshed.orderId, memoNumber: refreshed.order.memoNumber, patient: refreshed.order.patient,
    tests: refreshed.order.tests.filter(t => t.specimenId === refreshed.id),
  });
});

router.post('/:specimenNumber/reject', requireCapability('accept'), async (req, res) => {
  const { reason } = req.body || {};
  if (!reason) return res.status(400).json({ error: 'reason is required' });
  const rejectedBy = req.user.name; // acceptedBy is reused here to mean "who made this call" either way

  const specimen = await prisma.specimen.findUnique({ where: { specimenNumber: req.params.specimenNumber }, include: { order: true } });
  if (!specimen) return res.status(404).json({ error: 'No specimen found with that barcode number.' });
  if (specimen.order.orderingFacilityId !== req.user.facilityId) return res.status(403).json({ error: "Not this facility's specimen" });
  if (specimen.status !== 'collected') return res.status(409).json({ error: `Specimen is already ${specimen.status}` });

  await prisma.specimen.update({ where: { id: specimen.id }, data: { status: 'rejected', rejectionReason: reason, acceptedAt: new Date(), acceptedBy: rejectedBy } });
  await prisma.orderTest.updateMany({ where: { specimenId: specimen.id, status: 'collected' }, data: { status: 'rejected' } });

  const refreshed = await prisma.specimen.findUnique({ where: { id: specimen.id }, include: { order: { include: { tests: true, patient: true } } } });
  res.json({
    specimenNumber: refreshed.specimenNumber, category: refreshed.category, bottleType: refreshed.bottleType, status: refreshed.status,
    rejectionReason: refreshed.rejectionReason, rejectedBy: refreshed.acceptedBy,
    orderId: refreshed.orderId, memoNumber: refreshed.order.memoNumber, patient: refreshed.order.patient,
    tests: refreshed.order.tests.filter(t => t.specimenId === refreshed.id),
  });
});

module.exports = router;
