const jwt = require('jsonwebtoken');

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing bearer token' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    // payload: { userId, name, facilityId, tier }
    req.user = payload;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Only the Regional Hospital (top of the hierarchy) has admin rights: managing the network of
// labs and the shared test catalog.
function requireRegional(req, res, next) {
  if (!req.user || req.user.tier !== 'regional') {
    return res.status(403).json({ error: 'Regional Hospital admin rights required for this action' });
  }
  next();
}

module.exports = { requireAuth, requireRegional };
