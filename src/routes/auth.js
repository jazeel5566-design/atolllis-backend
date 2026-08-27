const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../db');
const { requireAuth } = require('../middleware/auth');
const { ROLE_LABELS } = require('../utils/roles');
const { ipInCidr, normalizeIp } = require('../utils/cidr');

// Public — needed to populate the "Lab / Facility" picker on the login screen (used only as a
// fallback when the network isn't recognized, or for the admin facility-selection step).
router.get('/facilities', async (req, res) => {
  const facilities = await prisma.facility.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, name: true, tier: true },
  });
  res.json(facilities);
});

// Public — the login screen calls this before showing the form. If this device's network matches
// a registered FacilityNetwork, that facility is assumed automatically and the picker never shows
// for ordinary staff. No match just means "no auto-detection available" — not an error.
router.get('/detect-facility', async (req, res) => {
  const ip = normalizeIp(req.ip);
  const networks = await prisma.facilityNetwork.findMany({ include: { facility: true } });
  const match = networks.find(n => ipInCidr(ip, n.cidr));
  if (!match) return res.json({ facilityId: null });
  res.json({ facilityId: match.facilityId, facilityName: match.facility.name, ip });
});

router.post('/login', async (req, res) => {
  const { facilityId, username, password, actingFacilityId } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password are required' });
  }

  // Ordinary staff are found at the network-detected (or manually picked) facility. If that comes
  // up empty, also check whether this username belongs to an Admin — Admins aren't tied to
  // whichever network they happen to be on, since they may be visiting another facility in person.
  let user = facilityId
    ? await prisma.user.findFirst({ where: { facilityId, username }, include: { facility: true } })
    : null;
  if (!user) {
    user = await prisma.user.findFirst({ where: { username, role: 'admin' }, include: { facility: true } });
  }
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

  // Password verified. An Admin now chooses which facility to operate as — everyone else is
  // locked to their own. This is the one extra step, and only for Admins.
  if (user.role === 'admin' && !actingFacilityId) {
    const facilities = await prisma.facility.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, tier: true } });
    return res.json({ requiresFacilitySelection: true, defaultFacilityId: facilityId || user.facilityId, facilities });
  }

  const effectiveFacility = user.role === 'admin' && actingFacilityId
    ? await prisma.facility.findUnique({ where: { id: actingFacilityId } })
    : user.facility;
  if (!effectiveFacility) return res.status(400).json({ error: 'Selected facility not found' });

  const token = jwt.sign(
    { userId: user.id, name: user.name, facilityId: effectiveFacility.id, tier: effectiveFacility.tier, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '12h' }
  );

  res.json({
    token,
    user: {
      userId: user.id,
      name: user.name,
      facilityId: effectiveFacility.id,
      facilityName: effectiveFacility.name,
      tier: effectiveFacility.tier,
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
