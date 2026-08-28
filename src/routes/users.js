const router = require('express').Router();
const bcrypt = require('bcryptjs');
const prisma = require('../db');
const { requireAuth, requireCapability } = require('../middleware/auth');
const { canGrantRole, ROLE_LABELS } = require('../utils/roles');
const { uid } = require('../utils/id');
const { logAudit } = require('../utils/audit');

router.use(requireAuth);
router.use(requireCapability('manage_users'));

function sanitize(u) {
  return {
    id: u.id, name: u.name, username: u.username, role: u.role, roleLabel: ROLE_LABELS[u.role] || u.role,
    facilityId: u.facilityId, createdAt: u.createdAt,
    facilityAccess: (u.facilityAccess || []).map(a => ({ facilityId: a.facilityId, facilityName: a.facility.name })),
  };
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
  const users = await prisma.user.findMany({
    where: { facilityId },
    include: { facilityAccess: { include: { facility: true } } },
    orderBy: { name: 'asc' },
  });
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
  const exists = await prisma.user.findUnique({ where: { username } });
  if (exists) return res.status(409).json({ error: 'That username is already taken' });

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: {
      name, username, passwordHash, role, facilityId,
      facilityAccess: { create: [{ id: uid('UFA'), facilityId }] }, // home facility is always authorized
    },
    include: { facilityAccess: { include: { facility: true } } },
  });
  await logAudit(req.user, { action: 'user_created', entityType: 'User', entityId: user.id, details: `Created ${name} (${username}) as ${ROLE_LABELS[role] || role}` });
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
  const changes = [];
  if (name && name !== user.name) { data.name = name; changes.push('name'); }
  if (role && role !== user.role) {
    if (!canGrantRole(req.user.role, role)) return res.status(403).json({ error: `Your role cannot grant "${role}"` });
    data.role = role;
    changes.push(`role → ${ROLE_LABELS[role] || role}`);
  }
  if (newPassword) {
    if (newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    data.passwordHash = await bcrypt.hash(newPassword, 10);
    changes.push('password reset');
  }

  const updated = await prisma.user.update({ where: { id }, data, include: { facilityAccess: { include: { facility: true } } } });
  if (changes.length) await logAudit(req.user, { action: 'user_updated', entityType: 'User', entityId: id, details: `Updated ${user.name}: ${changes.join(', ')}` });
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
  await logAudit(req.user, { action: 'user_removed', entityType: 'User', entityId: id, details: `Removed ${user.name} (${user.username})` });
  res.json({ ok: true });
});

// ---------- Facility access — grant/revoke additional facilities beyond the home one ----------
// This is what makes a login prompt for a facility at all: any account with more than one row
// here sees the picker after their password verifies; everyone else logs straight in.

router.post('/:id/facility-access', async (req, res) => {
  const { id } = req.params;
  const { facilityId } = req.body || {};
  if (!facilityId) return res.status(400).json({ error: 'facilityId is required' });
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return res.status(404).json({ error: 'Not found' });
  if (req.user.role !== 'admin' && user.facilityId !== req.user.facilityId) {
    return res.status(403).json({ error: "Not this facility's user" });
  }
  const facility = await prisma.facility.findUnique({ where: { id: facilityId } });
  if (!facility) return res.status(404).json({ error: 'Facility not found' });

  const exists = await prisma.userFacilityAccess.findUnique({ where: { userId_facilityId: { userId: id, facilityId } } });
  if (exists) return res.status(409).json({ error: 'Already authorized at that facility' });

  await prisma.userFacilityAccess.create({ data: { id: uid('UFA'), userId: id, facilityId } });
  await logAudit(req.user, { action: 'facility_access_granted', entityType: 'User', entityId: id, details: `Granted ${user.name} access to ${facility.name}` });

  const updated = await prisma.user.findUnique({ where: { id }, include: { facilityAccess: { include: { facility: true } } } });
  res.status(201).json(sanitize(updated));
});

router.delete('/:id/facility-access/:facilityId', async (req, res) => {
  const { id, facilityId } = req.params;
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return res.status(404).json({ error: 'Not found' });
  if (req.user.role !== 'admin' && user.facilityId !== req.user.facilityId) {
    return res.status(403).json({ error: "Not this facility's user" });
  }
  if (facilityId === user.facilityId) {
    return res.status(409).json({ error: "Can't revoke access to a user's home facility — change their home facility first, or remove the account." });
  }

  const facility = await prisma.facility.findUnique({ where: { id: facilityId } });
  await prisma.userFacilityAccess.deleteMany({ where: { userId: id, facilityId } });
  await logAudit(req.user, { action: 'facility_access_revoked', entityType: 'User', entityId: id, details: `Revoked ${user.name}'s access to ${facility ? facility.name : facilityId}` });

  const updated = await prisma.user.findUnique({ where: { id }, include: { facilityAccess: { include: { facility: true } } } });
  res.json(sanitize(updated));
});

module.exports = router;
