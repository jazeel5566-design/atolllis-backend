// AtollLIS role-based access control.
//
// Roles are NOT a strict ladder where each includes the one below — they're explicit capability
// sets, because real lab roles don't nest cleanly (e.g. a Lab Manager isn't just "senior Pathologist").
//
//   phlebotomist  — draws and collects samples only
//   technologist  — collection, acceptance, and running results through the analyser
//   pathologist   — everything a technologist does, plus validating & certifying results
//   lab_manager   — everything a pathologist does, plus managing staff at their own facility
//   admin         — everything a lab_manager does, plus test catalog / categories / lab network
//                    (in practice, only ever granted to Regional Hospital staff)
const ROLE_CAPABILITIES = {
  phlebotomist: ['collect'],
  technologist: ['collect', 'accept', 'process'],
  pathologist: ['collect', 'accept', 'process', 'certify'],
  lab_manager: ['collect', 'accept', 'process', 'certify', 'manage_users'],
  admin: ['collect', 'accept', 'process', 'certify', 'manage_users', 'manage_catalog', 'manage_labs'],
};

const ROLE_LABELS = {
  phlebotomist: 'Phlebotomist',
  technologist: 'Technologist',
  pathologist: 'Pathologist',
  lab_manager: 'Lab Manager',
  admin: 'Administrator',
};

function roleHasCapability(role, capability) {
  return (ROLE_CAPABILITIES[role] || []).includes(capability);
}

// Who's allowed to grant a given role to someone else — you can't hand out more power than you
// have. Only an admin can create another admin.
function canGrantRole(granterRole, targetRole) {
  if (!ROLE_CAPABILITIES[targetRole]) return false;
  if (targetRole === 'admin') return granterRole === 'admin';
  return roleHasCapability(granterRole, 'manage_users');
}

module.exports = { ROLE_CAPABILITIES, ROLE_LABELS, roleHasCapability, canGrantRole };
