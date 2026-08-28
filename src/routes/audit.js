const router = require('express').Router();
const prisma = require('../db');
const { requireAuth, requireCapability } = require('../middleware/auth');

router.use(requireAuth);
router.use(requireCapability('view_audit'));

router.get('/', async (req, res) => {
  const { facilityId, action, limit } = req.query;
  const take = Math.min(parseInt(limit, 10) || 100, 500);

  const where = {};
  if (req.user.role === 'admin') {
    if (facilityId) where.facilityId = facilityId;
  } else {
    where.facilityId = req.user.facilityId; // non-admins never see another facility's log
  }
  if (action) where.action = action;

  const entries = await prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, take });
  res.json(entries);
});

module.exports = router;
