const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../db');
const { requireAuth } = require('../middleware/auth');
const { ROLE_LABELS } = require('../utils/roles');
const { ipInCidr, normalizeIp } = require('../utils/cidr');
const { logAudit } = require('../utils/audit');

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
  const { username, password, actingFacilityId } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password are required' });
  }

  const user = await prisma.user.findUnique({
    where: { username },
    include: { facility: true, facilityAccess: { include: { facility: true } } },
  });
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

  const authorized = user.facilityAccess.map(a => a.facility);
  if (!authorized.length) {
    return res.status(403).json({ error: 'This account is not authorized at any facility — contact your lab manager.' });
  }

  // Exactly one authorized facility: log straight in, no picker. More than one: password is
  // already verified at this point — now, and only now, offer a choice between the facilities
  // this specific account is actually authorized at (never the full facility list).
  let effectiveFacility;
  if (authorized.length === 1) {
    effectiveFacility = authorized[0];
  } else if (!actingFacilityId) {
    return res.json({
      requiresFacilitySelection: true,
      defaultFacilityId: user.facilityId,
      facilities: authorized.map(f => ({ id: f.id, name: f.name, tier: f.tier })),
    });
  } else {
    effectiveFacility = authorized.find(f => f.id === actingFacilityId);
    if (!effectiveFacility) return res.status(403).json({ error: 'You are not authorized at that facility.' });
  }

  const token = jwt.sign(
    { userId: user.id, name: user.name, facilityId: effectiveFacility.id, tier: effectiveFacility.tier, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '12h' }
  );

  await logAudit(
    { userId: user.id, name: user.name, facilityId: effectiveFacility.id },
    { action: 'login', entityType: 'User', entityId: user.id, details: `Logged in as ${ROLE_LABELS[user.role] || user.role}` }
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
