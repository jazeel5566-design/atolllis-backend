const jwt = require('jsonwebtoken');
const { roleHasCapability } = require('../utils/roles');

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

// Role-based access control — replaces the old tier-only check. Each route declares which
// capability it needs (see src/utils/roles.js for the role → capability map).
function requireCapability(capability) {
  return function (req, res, next) {
    if (!req.user || !roleHasCapability(req.user.role, capability)) {
      return res.status(403).json({ error: `Your role does not have permission to do this (requires: ${capability})` });
    }
    next();
  };
}

module.exports = { requireAuth, requireCapability };
