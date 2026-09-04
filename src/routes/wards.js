const router = require('express').Router();
const prisma = require('../db');
const { requireAuth, requireCapability } = require('../middleware/auth');
const { uid } = require('../utils/id');

router.use(requireAuth);

// Lab managers see/manage their own facility's wards. Admins may target another facility via
// ?facilityId= — same pattern already used for user management.
function targetFacilityId(req) {
  const requested = req.query.facilityId || req.body.facilityId;
  if (requested && req.user.role === 'admin') return requested;
  return req.user.facilityId;
}

// Any authenticated user can read the list — needed to populate the Ward dropdown at collection.
router.get('/', async (req, res) => {
  const facilityId = req.query.facilityId || req.user.facilityId;
  const wards = await prisma.ward.findMany({ where: { facilityId }, orderBy: { name: 'asc' } });
  res.json(wards);
});

router.post('/', requireCapability('manage_users'), async (req, res) => {
  const { name } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' });
  const facilityId = targetFacilityId(req);
  const exists = await prisma.ward.findUnique({ where: { facilityId_name: { facilityId, name: name.trim() } } });
  if (exists) return res.status(409).json({ error: `A ward named "${name}" already exists` });
  const ward = await prisma.ward.create({ data: { id: uid('WARD'), facilityId, name: name.trim() } });
  res.status(201).json(ward);
});

router.delete('/:id', requireCapability('manage_users'), async (req, res) => {
  const ward = await prisma.ward.findUnique({ where: { id: req.params.id } });
  if (!ward) return res.status(404).json({ error: 'Not found' });
  if (req.user.role !== 'admin' && ward.facilityId !== req.user.facilityId) {
    return res.status(403).json({ error: "Not this facility's ward" });
  }
  await prisma.ward.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

module.exports = router;
