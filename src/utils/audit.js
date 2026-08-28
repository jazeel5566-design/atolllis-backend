const prisma = require('../db');
const { uid } = require('./id');

// actor matches req.user's shape ({ userId, name, facilityId, ... }) — pass req.user directly at
// most call sites. Login builds an equivalent object manually, since there's no token/req.user yet
// at the moment a login succeeds. Never throws into the caller — logging failure shouldn't block
// the action it's recording.
async function logAudit(actor, { action, entityType, entityId, details }) {
  try {
    let facilityName = 'Unknown';
    if (actor && actor.facilityId) {
      const f = await prisma.facility.findUnique({ where: { id: actor.facilityId }, select: { name: true } });
      if (f) facilityName = f.name;
    }
    await prisma.auditLog.create({
      data: {
        id: uid('LOG'),
        userId: actor ? actor.userId : null,
        userName: actor ? actor.name : 'System',
        facilityId: actor ? actor.facilityId : 'unknown',
        facilityName,
        action,
        entityType: entityType || null,
        entityId: entityId || null,
        details: details || null,
      },
    });
  } catch (e) {
    console.error('audit log failed:', e.message);
  }
}

module.exports = { logAudit };
