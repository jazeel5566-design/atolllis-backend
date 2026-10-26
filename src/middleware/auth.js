const jwt = require('jsonwebtoken');
const prisma = require('../db');

const SESSION_ENDED = 'Your session has ended — log in again to continue.';

// Checks the login token, then the account itself on every request: a disabled or removed
// account, a password or status change since the token was issued (tokenVersion), or access to
// the acting facility having been revoked all end the session at once instead of when the token
// expires. The role is read from the account, so a role change applies to the next request.
// A password set by someone else blocks everything except changing it (allowPasswordChange).
function authenticate({ allowPasswordChange = false } = {}) {
  return async function (req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Missing bearer token' });
    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET); // { userId, name, facilityId, tier, role, tv }
    } catch (e) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    try {
      const user = await prisma.user.findUnique({
        where: { id: payload.userId },
        select: {
          name: true, role: true, active: true, tokenVersion: true, mustChangePassword: true,
          facilityAccess: { where: { facilityId: payload.facilityId }, select: { facilityId: true } },
        },
      });
      if (!user || !user.active || user.tokenVersion !== (payload.tv || 0) || !user.facilityAccess.length) {
        return res.status(401).json({ error: SESSION_ENDED });
      }
      if (user.mustChangePassword && !allowPasswordChange) {
        return res.status(403).json({ error: 'Change your password before continuing.', mustChangePassword: true });
      }
      req.user = { ...payload, name: user.name, role: user.role };
      next();
    } catch (e) { next(e); }
  };
}

const requireAuth = authenticate();
const requireAuthForPasswordChange = authenticate({ allowPasswordChange: true });

// Role-based access control. Which capabilities a role has is stored in the RoleCapability table
// (editable by an Admin under Settings), not fixed in code — this middleware is just the gate.
function requireCapability(capability) {
  return async function (req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    try {
      const match = await prisma.roleCapability.findUnique({ where: { role_capability: { role: req.user.role, capability } } });
      if (!match) return res.status(403).json({ error: `Your role does not have permission to do this (requires: ${capability})` });
      next();
    } catch (e) { next(e); }
  };
}

module.exports = { requireAuth, requireAuthForPasswordChange, requireCapability };
