const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../db');
const { requireAuthForPasswordChange } = require('../middleware/auth');
const { ROLE_LABELS } = require('../utils/roles');
const { ipInCidr, normalizeIp } = require('../utils/cidr');
const { logAudit } = require('../utils/audit');
const { MAX_FAILED_LOGINS, LOCKOUT_MINUTES, passwordProblem } = require('../utils/password');

const fmtTime = d => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Indian/Maldives' });

function signToken(user, facility) {
  return jwt.sign(
    { userId: user.id, name: user.name, facilityId: facility.id, tier: facility.tier, role: user.role, tv: user.tokenVersion },
    process.env.JWT_SECRET,
    { expiresIn: '12h' }
  );
}

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
  const actor = { userId: user.id, name: user.name, facilityId: user.facilityId };

  // A locked account is refused before the password is even checked, so guessing gains nothing.
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    return res.status(423).json({ error: `This account is locked until ${fmtTime(user.lockedUntil)} after ${MAX_FAILED_LOGINS} wrong passwords. A lab manager can unlock it sooner.` });
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    const failed = user.failedLoginCount + 1;
    if (failed >= MAX_FAILED_LOGINS) {
      const lockedUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60000);
      await prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil } });
      await logAudit(actor, { action: 'account_locked', entityType: 'User', entityId: user.id, details: `Locked for ${LOCKOUT_MINUTES} minutes after ${MAX_FAILED_LOGINS} wrong passwords` });
      return res.status(423).json({ error: `Too many wrong passwords. This account is locked until ${fmtTime(lockedUntil)}. A lab manager can unlock it sooner.` });
    }
    await prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: failed } });
    await logAudit(actor, { action: 'login_failed', entityType: 'User', entityId: user.id, details: `Wrong password (${failed} of ${MAX_FAILED_LOGINS})` });
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  if (!user.active) return res.status(403).json({ error: 'This account has been disabled — contact your lab manager.' });
  if (user.failedLoginCount || user.lockedUntil) {
    await prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null } });
  }

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

  const token = signToken(user, effectiveFacility);

  await logAudit(
    { userId: user.id, name: user.name, facilityId: effectiveFacility.id },
    { action: 'login', entityType: 'User', entityId: user.id, details: `Logged in as ${ROLE_LABELS[user.role] || user.role}` }
  );

  res.json({
    token,
    user: {
      userId: user.id,
      name: user.name,
      username: user.username,
      facilityId: effectiveFacility.id,
      facilityName: effectiveFacility.name,
      tier: effectiveFacility.tier,
      role: user.role,
      roleLabel: ROLE_LABELS[user.role] || user.role,
      mustChangePassword: user.mustChangePassword,
    },
  });
});

// Self-service password change — any authenticated user, their own account only. Also the one
// thing an account with a password set by someone else may do. Every other session of this
// account ends; this one carries on with the fresh token in the reply.
router.post('/change-password', requireAuthForPasswordChange, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'currentPassword and newPassword are required' });
  }
  const user = await prisma.user.findUnique({ where: { id: req.user.userId } });
  if (!user) return res.status(404).json({ error: 'User not found' });
  const problem = passwordProblem(newPassword, user.username);
  if (problem) return res.status(400).json({ error: problem });

  const ok = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!ok) return res.status(400).json({ error: 'Current password is incorrect' });
  if (await bcrypt.compare(newPassword, user.passwordHash)) {
    return res.status(400).json({ error: 'The new password must be different from the current one' });
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash, mustChangePassword: false, passwordChangedAt: new Date(), tokenVersion: { increment: 1 } },
  });
  const facility = await prisma.facility.findUnique({ where: { id: req.user.facilityId } });
  await logAudit(req.user, { action: 'password_changed', entityType: 'User', entityId: user.id, details: 'Changed own password' });
  res.json({ ok: true, token: signToken(updated, facility) });
});

module.exports = router;
