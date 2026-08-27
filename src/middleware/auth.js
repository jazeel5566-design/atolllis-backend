const jwt = require('jsonwebtoken');
const prisma = require('../db');

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing bearer token' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    // payload: { userId, name, facilityId, tier, role }
    req.user = payload;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

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

module.exports = { requireAuth, requireCapability };
