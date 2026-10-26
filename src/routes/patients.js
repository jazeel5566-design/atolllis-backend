const router = require('express').Router();
const prisma = require('../db');
const { requireAuth } = require('../middleware/auth');
const { uid } = require('../utils/id');
const { logAudit } = require('../utils/audit');

router.use(requireAuth);

router.get('/', async (req, res) => {
  const { query } = req.query;
  const where = query
    ? {
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { hospitalNumber: { contains: query, mode: 'insensitive' } },
          { idNumber: { contains: query, mode: 'insensitive' } },
        ],
      }
    : {};
  const patients = await prisma.patient.findMany({ where, take: 50, orderBy: { name: 'asc' } });
  res.json(patients);
});

// Manual registration is a fallback path — the primary path is via HIS/Billing memo import,
// which auto-creates the patient record from what the external system sends.
router.post('/', async (req, res) => {
  const { name, dob, sex, hospitalNumber, idNumber, address, homeFacilityId } = req.body || {};
  if (!name || !dob) return res.status(400).json({ error: 'name and dob are required' });
  const patient = await prisma.patient.create({
    data: {
      id: uid('PT'),
      name, dob, sex: sex || 'F',
      hospitalNumber: hospitalNumber || null,
      idNumber: idNumber || null,
      address: address || null,
      homeFacilityId: homeFacilityId || req.user.facilityId,
    },
  });
  await logAudit(req.user, { action: 'patient_registered', entityType: 'Patient', entityId: patient.id, details: `Registered ${patient.name} manually` });
  res.status(201).json(patient);
});

module.exports = router;
