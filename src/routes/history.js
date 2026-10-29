const router = require('express').Router();
const prisma = require('../db');
const { requireAuth, userHasCapability } = require('../middleware/auth');
const { visibleOrdersForPatient } = require('../utils/patient-results');

router.use(requireAuth);

router.get('/', async (req, res) => {
  const { query } = req.query;
  if (!query) return res.json([]);
  const fid = req.user.facilityId;
  const seeUnfinished = await userHasCapability(req.user, 'view_patient_records');

  const patients = await prisma.patient.findMany({
    where: {
      OR: [
        { name: { contains: query, mode: 'insensitive' } },
        { hospitalNumber: { contains: query, mode: 'insensitive' } },
        { idNumber: { contains: query, mode: 'insensitive' } },
      ],
    },
    take: 20,
  });

  const results = [];
  for (const p of patients) {
    const orders = await visibleOrdersForPatient(prisma, p, fid, { seeUnfinished });
    if (orders.length) results.push({ patient: p, orders });
  }

  res.json(results);
});

module.exports = router;
