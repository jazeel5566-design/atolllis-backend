const router = require('express').Router();
const prisma = require('../db');
const { requireAuth, requireCapability } = require('../middleware/auth');
const { uid } = require('../utils/id');
const { logAudit } = require('../utils/audit');

router.use(requireAuth);

// Any authenticated user can read the list — needed at Sample Acceptance to populate the dropdown.
router.get('/', async (req, res) => {
  const reasons = await prisma.rejectionReason.findMany({ orderBy: { name: 'asc' } });
  res.json(reasons);
});

router.post('/', requireCapability('manage_catalog'), async (req, res) => {
  const { name } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' });
  const exists = await prisma.rejectionReason.findUnique({ where: { name: name.trim() } });
  if (exists) return res.status(409).json({ error: `"${name}" already exists` });
  const reason = await prisma.rejectionReason.create({ data: { id: uid('RR'), name: name.trim() } });
  await logAudit(req.user, { action: 'rejection_reason_created', entityType: 'RejectionReason', entityId: reason.id, details: `Added rejection reason "${reason.name}"` });
  res.status(201).json(reason);
});

router.delete('/:id', requireCapability('manage_catalog'), async (req, res) => {
  const reason = await prisma.rejectionReason.findUnique({ where: { id: req.params.id } });
  if (!reason) return res.status(404).json({ error: 'Not found' });
  await prisma.rejectionReason.delete({ where: { id: reason.id } });
  await logAudit(req.user, { action: 'rejection_reason_deleted', entityType: 'RejectionReason', entityId: reason.id, details: `Removed rejection reason "${reason.name}"` });
  res.json({ ok: true });
});

module.exports = router;
