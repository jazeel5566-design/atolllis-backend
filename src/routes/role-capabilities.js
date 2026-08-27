const router = require('express').Router();
const prisma = require('../db');
const { requireAuth } = require('../middleware/auth');
const { ROLE_LABELS, ALL_ROLES, ALL_CAPABILITIES, CAPABILITY_LABELS } = require('../utils/roles');

router.use(requireAuth);

// Everyone can read the current assignment (needed just to show/hide their own UI correctly).
router.get('/', async (req, res) => {
  const rows = await prisma.roleCapability.findMany();
  const byRole = {};
  ALL_ROLES.forEach(r => { byRole[r] = []; });
  rows.forEach(r => { if (byRole[r.role]) byRole[r.role].push(r.capability); });
  res.json({ roles: ALL_ROLES.map(r => ({ role: r, label: ROLE_LABELS[r], capabilities: byRole[r] })), allCapabilities: ALL_CAPABILITIES.map(c => ({ capability: c, label: CAPABILITY_LABELS[c] || c })) });
});

// Editing is deliberately gated by a raw role check, not requireCapability — a capability-based
// gate here would let a role that already has manage_users grant itself anything, including admin
// powers. Only an actual Admin account can change what any role is allowed to do.
router.put('/:role', async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only an Admin can change role permissions' });
  const { role } = req.params;
  if (!ALL_ROLES.includes(role)) return res.status(400).json({ error: 'Unknown role' });
  const { capabilities } = req.body || {};
  if (!Array.isArray(capabilities)) return res.status(400).json({ error: 'capabilities must be an array' });
  const valid = capabilities.filter(c => ALL_CAPABILITIES.includes(c));
  if (role === 'admin' && !valid.includes('manage_users')) {
    return res.status(409).json({ error: 'The Admin role must always keep "Manage Staff Accounts" — removing it would lock every admin out of this page.' });
  }

  await prisma.roleCapability.deleteMany({ where: { role } });
  if (valid.length) {
    await prisma.roleCapability.createMany({ data: valid.map(capability => ({ id: `${role}_${capability}`, role, capability })) });
  }
  res.json({ role, capabilities: valid });
});

module.exports = router;
