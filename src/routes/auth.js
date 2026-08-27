const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../db');
const { requireAuth } = require('../middleware/auth');
const { ROLE_LABELS } = require('../utils/roles');

// Public — needed to populate the "Lab / Facility" picker on the login screen.
router.get('/facilities', async (req, res) => {
  const facilities = await prisma.facility.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, name: true, tier: true },
  });
  res.json(facilities);
});

router.post('/login', async (req, res) => {
  const { facilityId, username, password } = req.body || {};
  if (!facilityId || !username || !password) {
    return res.status(400).json({ error: 'facilityId, username and password are required' });
  }
  const user = await prisma.user.findFirst({
    where: { facilityId, username },
    include: { facility: true },
  });
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

  const token = jwt.sign(
    { userId: user.id, name: user.name, facilityId: user.facilityId, tier: user.facility.tier, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '12h' }
  );

  res.json({
    token,
    user: {
      userId: user.id,
      name: user.name,
      facilityId: user.facilityId,
      facilityName: user.facility.name,
      tier: user.facility.tier,
      role: user.role,
      roleLabel: ROLE_LABELS[user.role] || user.role,
    },
  });
});

// Self-service password change — any authenticated user, their own account only.
router.post('/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'currentPassword and newPassword are required' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  }
  const user = await prisma.user.findUnique({ where: { id: req.user.userId } });
  if (!user) return res.status(404).json({ error: 'User not found' });

  const ok = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Current password is incorrect' });

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
  res.json({ ok: true });
});

module.exports = router;
