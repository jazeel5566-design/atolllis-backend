const router = require('express').Router();
const prisma = require('../db');
const { requireAuth, requireCapability } = require('../middleware/auth');
const { uid } = require('../utils/id');
const { logAudit } = require('../utils/audit');
const { visibleOrdersForPatient } = require('../utils/patient-results');
const { cleanDhivehi } = require('../utils/dhivehi');

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

// Orders this facility can see for a patient: placed here, or with a test referred here.
const visibleHere = fid => ({ sampleStatus: { not: null }, OR: [{ orderingFacilityId: fid }, { tests: { some: { referred: true, performingFacilityId: fid } } }] });

// Patients with lab work at this facility, for the Patients screen. Until visits exist, a clinician
// may open any of them; each folder opened is written to the audit log (below).
router.get('/records', requireCapability('view_patient_records'), async (req, res) => {
  const query = String(req.query.query || '').trim();
  if (query.length < 2) return res.json([]);
  const fid = req.user.facilityId;
  const patients = await prisma.patient.findMany({
    where: {
      orders: { some: visibleHere(fid) },
      OR: [
        { name: { contains: query, mode: 'insensitive' } },
        { hospitalNumber: { contains: query, mode: 'insensitive' } },
        { idNumber: { contains: query, mode: 'insensitive' } },
      ],
    },
    include: { orders: { where: visibleHere(fid), select: { collectedAt: true }, orderBy: { collectedAt: 'desc' } } },
    take: 30,
    orderBy: { name: 'asc' },
  });
  res.json(patients.map(({ orders, ...p }) => ({ patient: p, visits: orders.length, lastCollectedAt: orders[0] ? orders[0].collectedAt : null })));
});

// The patient folder: every order this facility can see, with each report's hand-overs.
router.get('/:id/folder', requireCapability('view_patient_records'), async (req, res) => {
  const fid = req.user.facilityId;
  const patient = await prisma.patient.findUnique({ where: { id: req.params.id } });
  const orders = patient ? await visibleOrdersForPatient(prisma, patient, fid, { seeUnfinished: true }) : [];
  if (!orders.length) return res.status(404).json({ error: 'No lab records for this patient at your facility.' });
  const handovers = await prisma.reportHandover.findMany({
    where: { orderId: { in: orders.filter(o => o.own).map(o => o.orderId) }, facilityId: fid },
    orderBy: { handedAt: 'asc' },
  });
  for (const o of orders) o.handovers = handovers.filter(h => h.orderId === o.orderId);
  await logAudit(req.user, { action: 'patient_folder_viewed', entityType: 'Patient', entityId: patient.id, details: `Opened the folder of ${patient.name}` });
  res.json({ patient, orders });
});

// The patient's name in Thaana, printed under the English name on reports. Set at the facility
// that ordered the patient's tests (usually by reception, at hand-over).
router.put('/:id/dhivehi-name', requireCapability('dispatch_reports'), async (req, res) => {
  const nameDhivehi = cleanDhivehi((req.body || {}).nameDhivehi, 'The Dhivehi name', 120);
  const patient = await prisma.patient.findFirst({ where: { id: req.params.id, orders: { some: { orderingFacilityId: req.user.facilityId } } } });
  if (!patient) return res.status(404).json({ error: 'No patient with orders from your facility.' });
  const updated = await prisma.patient.update({ where: { id: patient.id }, data: { nameDhivehi } });
  await logAudit(req.user, { action: 'patient_dhivehi_name', entityType: 'Patient', entityId: patient.id, details: nameDhivehi ? `Set the Dhivehi name of ${patient.name}` : `Removed the Dhivehi name of ${patient.name}` });
  res.json(updated);
});

module.exports = router;
