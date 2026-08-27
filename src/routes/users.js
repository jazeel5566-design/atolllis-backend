const router = require('express').Router();
const bcrypt = require('bcryptjs');
const prisma = require('../db');
const { requireAuth, requireCapability } = require('../middleware/auth');
const { canGrantRole, ROLE_LABELS } = require('../utils/roles');

router.use(requireAuth);
router.use(requireCapability('manage_users'));

function sanitize(u) {
  return { id: u.id, name: u.name, username: u.username, role: u.role, roleLabel: ROLE_LABELS[u.role] || u.role, facilityId: u.facilityId, createdAt: u.createdAt };
}

// Lab managers only ever see/manage their own facility's staff. Admins may also target another
// facility via ?facilityId= — useful right after creating a brand-new lab that has no users yet.
function targetFacilityId(req) {
  const requested = req.query.facilityId || req.body.facilityId;
  if (requested && req.user.role === 'admin') return requested;
  return req.user.facilityId;
}

router.get('/', async (req, res) => {
  const facilityId = targetFacilityId(req);
  const users = await prisma.user.findMany({ where: { facilityId }, orderBy: { name: 'asc' } });
  res.json(users.map(sanitize));
});

router.post('/', async (req, res) => {
  const { name, username, password, role } = req.body || {};
  if (!name || !username || !password || !role) {
    return res.status(400).json({ error: 'name, username, password, and role are required' });
  }
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (!canGrantRole(req.user.role, role)) {
    return res.status(403).json({ error: `Your role cannot grant "${role}"` });
  }
  const facilityId = targetFacilityId(req);
  const exists = await prisma.user.findFirst({ where: { facilityId, username } });
  if (exists) return res.status(409).json({ error: 'That username is already in use at this facility' });

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({ data: { name, username, passwordHash, role, facilityId } });
  res.status(201).json(sanitize(user));
});

router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { name, role, newPassword } = req.body || {};
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return res.status(404).json({ error: 'Not found' });
  if (req.user.role !== 'admin' && user.facilityId !== req.user.facilityId) {
    return res.status(403).json({ error: "Not this facility's user" });
  }

  const data = {};
  if (name) data.name = name;
  if (role && role !== user.role) {
    if (!canGrantRole(req.user.role, role)) return res.status(403).json({ error: `Your role cannot grant "${role}"` });
    data.role = role;
  }
  if (newPassword) {
    if (newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    data.passwordHash = await bcrypt.hash(newPassword, 10);
  }

  const updated = await prisma.user.update({ where: { id }, data });
  res.json(sanitize(updated));
});

router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return res.status(404).json({ error: 'Not found' });
  if (req.user.role !== 'admin' && user.facilityId !== req.user.facilityId) {
    return res.status(403).json({ error: "Not this facility's user" });
  }
  if (user.id === req.user.userId) return res.status(400).json({ error: 'Cannot delete your own account while logged in as it' });

  const remaining = await prisma.user.count({ where: { facilityId: user.facilityId } });
  if (remaining <= 1) return res.status(409).json({ error: 'Cannot remove the last remaining user at a facility' });

  await prisma.user.delete({ where: { id } });
  res.json({ ok: true });
});

module.exports = router;
