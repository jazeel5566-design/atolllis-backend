const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../db');

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
    { userId: user.id, name: user.name, facilityId: user.facilityId, tier: user.facility.tier },
    process.env.JWT_SECRET,
    { expiresIn: '12h' }
  );

  res.json({
    token,
    user: {
      name: user.name,
      facilityId: user.facilityId,
      facilityName: user.facility.name,
      tier: user.facility.tier,
    },
  });
});

module.exports = router;
