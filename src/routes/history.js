const router = require('express').Router();
const prisma = require('../db');
const { requireAuth } = require('../middleware/auth');
const { evalResult } = require('../utils/domain');

router.use(requireAuth);

router.get('/', async (req, res) => {
  const { query } = req.query;
  if (!query) return res.json([]);
  const fid = req.user.facilityId;

  const patients = await prisma.patient.findMany({
    where: {
      OR: [
        { name: { contains: query } },
        { hospitalNumber: { contains: query } },
        { idNumber: { contains: query } },
      ],
    },
    take: 20,
  });

  const results = [];
  for (const p of patients) {
    const orders = await prisma.order.findMany({
      where: { patientId: p.id, sampleStatus: { not: null } },
      include: { tests: true, specimens: true, ward: true },
      orderBy: { createdAt: 'desc' },
    });

    const visibleOrders = [];
    for (const o of orders) {
      const own = o.orderingFacilityId === fid;
      // Full order if this facility placed it; otherwise only the specific tests referred to it.
      const tests = (own ? o.tests : o.tests.filter(t => t.referred && t.performingFacilityId === fid))
        .filter(t => t.status !== 'deselected');
      if (!tests.length) continue;

      const codes = tests.map(t => t.code);
      const catalogTests = await prisma.testDefinition.findMany({ where: { code: { in: codes } } });
      const lines = tests.map(t => {
        const specimen = o.specimens.find(s => s.id === t.specimenId);
        const specimenNumber = specimen ? specimen.specimenNumber : null;
        if (t.status !== 'completed') return { code: t.code, name: t.name, status: t.status, specimenNumber, isStat: t.isStat };
        const tc = catalogTests.find(c => c.code === t.code);
        const info = tc ? evalResult(tc, p, t.value) : {};
        return { code: t.code, name: t.name, value: t.value, unit: t.unit, ...info, specimenNumber, isStat: t.isStat, validatedBy: t.validatedBy, validatedAt: t.validatedAt };
      });
      visibleOrders.push({
        orderId: o.id, memoNumber: o.memoNumber, createdAt: o.createdAt, own, tests: lines,
        patientType: o.patientType, wardName: o.ward ? o.ward.name : null,
      });
    }
    if (visibleOrders.length) results.push({ patient: p, orders: visibleOrders });
  }

  res.json(results);
});

module.exports = router;
