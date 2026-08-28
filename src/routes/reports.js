const router = require('express').Router();
const prisma = require('../db');
const { requireAuth } = require('../middleware/auth');
const { evalResult } = require('../utils/domain');

router.use(requireAuth);

router.get('/:orderId', async (req, res) => {
  const order = await prisma.order.findUnique({
    where: { id: req.params.orderId },
    include: { tests: true, patient: true, orderingFacility: true, specimens: true },
  });
  if (!order) return res.status(404).json({ error: 'Not found' });

  // Reports are issued by the ordering facility, whether tests were performed locally or referred —
  // that's true even for a referred test, since the certified result flows back automatically.
  if (order.orderingFacilityId !== req.user.facilityId) {
    return res.status(403).json({ error: 'Only the ordering facility can view/issue this report' });
  }

  const relevantTests = order.tests.filter(t => t.status !== 'deselected');
  const codes = relevantTests.map(t => t.code);
  const catalogTests = await prisma.testDefinition.findMany({ where: { code: { in: codes } }, include: { refRanges: true } });
  const performingFacilities = await prisma.facility.findMany({ where: { id: { in: relevantTests.map(t => t.performingFacilityId) } } });

  const lines = await Promise.all(relevantTests.map(async t => {
    const tc = catalogTests.find(c => c.code === t.code);
    const pf = performingFacilities.find(f => f.id === t.performingFacilityId);
    const specimen = order.specimens.find(s => s.id === t.specimenId);
    const specimenNumber = specimen ? specimen.specimenNumber : null;
    if (t.status !== 'completed') {
      return { code: t.code, name: t.name, status: t.status, performingFacility: pf ? pf.name : null, referred: t.referred, specimenNumber };
    }
    if (tc && tc.isCulture) {
      const cultureResult = await prisma.cultureResult.findUnique({
        where: { orderTestId: t.id },
        include: { organisms: { include: { organism: true, sensitivities: { include: { antibiotic: true } } } } },
      });
      return {
        code: t.code, name: t.name, isCulture: true, cultureResult,
        performingFacility: pf ? pf.name : null, referred: t.referred, specimenNumber,
        validatedBy: t.validatedBy, validatedAt: t.validatedAt,
      };
    }
    const info = tc ? evalResult(tc, order.patient, t.value) : { flag: 'N/A', flagLabel: '', rangeText: '' };
    return {
      code: t.code, name: t.name, method: tc ? tc.method : null, value: t.value, unit: t.unit,
      ...info,
      performingFacility: pf ? pf.name : null, referred: t.referred, specimenNumber,
      validatedBy: t.validatedBy, validatedAt: t.validatedAt, comment: tc ? tc.comment : null,
    };
  }));

  res.json({
    order: { id: order.id, memoNumber: order.memoNumber, createdAt: order.createdAt, orderedBy: order.orderedBy },
    facility: { name: order.orderingFacility.name },
    patient: order.patient,
    specimens: order.specimens.map(s => ({ specimenNumber: s.specimenNumber, bottleType: s.bottleType })),
    lines,
  });
});

module.exports = router;
