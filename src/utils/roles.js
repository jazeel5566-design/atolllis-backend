// AtollLIS role-based access control.
//
// Roles are NOT a strict ladder where each includes the one below — they're explicit capability
// sets, because real lab roles don't nest cleanly (e.g. a Lab Manager isn't just "senior Pathologist").
//
//   phlebotomist  — draws and collects samples, and hands out final reports
//   reception_clerk — main reception: hands out final reports (no lab work, no unfinished results)
//   clinician     — reads every result for patients with lab work at their facility, including
//                    preliminary reports and the patient folder; hands nothing out
//   technologist  — collection, acceptance, and running results through the analyser
//   pathologist   — everything a technologist does, plus validating & certifying results
//   lab_manager   — everything a pathologist does, plus managing staff at their own facility
//   admin         — everything a lab_manager does, plus test catalog / categories / lab network
//                    (in practice, only ever granted to Regional Hospital staff)
const REPORTS_ALL = ['view_reports', 'dispatch_reports', 'view_patient_records'];
const ROLE_CAPABILITIES = {
  phlebotomist: ['collect', 'view_reports', 'dispatch_reports'],
  reception_clerk: ['view_reports', 'dispatch_reports'],
  clinician: ['view_reports', 'view_patient_records'],
  technologist: ['collect', 'accept', 'process', ...REPORTS_ALL],
  pathologist: ['collect', 'accept', 'process', 'certify', ...REPORTS_ALL],
  lab_manager: ['collect', 'accept', 'process', 'certify', 'manage_users', ...REPORTS_ALL],
  admin: ['collect', 'accept', 'process', 'certify', 'manage_users', 'manage_catalog', 'manage_labs', ...REPORTS_ALL],
};

const ROLE_LABELS = {
  phlebotomist: 'Phlebotomist',
  reception_clerk: 'Reception Clerk',
  clinician: 'Clinician',
  technologist: 'Technologist',
  pathologist: 'Pathologist',
  lab_manager: 'Lab Manager',
  admin: 'Administrator',
};

const CAPABILITY_LABELS = {
  collect: 'Sample Collection',
  accept: 'Sample Acceptance',
  process: 'Result Processing (analyser + entry)',
  certify: 'Validate & Certify Results',
  manage_users: 'Manage Staff Accounts',
  manage_catalog: 'Manage Test Catalog & Categories',
  manage_labs: 'Manage Lab Network & Facility Networks',
  view_audit: 'View Audit Log',
  view_reports: 'View Reports',
  dispatch_reports: 'Hand Out Reports',
  view_patient_records: 'Patient Records & Preliminary Results',
};

const ALL_ROLES = Object.keys(ROLE_LABELS);
const ALL_CAPABILITIES = Object.keys(CAPABILITY_LABELS);

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

module.exports = { ROLE_CAPABILITIES, ROLE_LABELS, CAPABILITY_LABELS, ALL_ROLES, ALL_CAPABILITIES, roleHasCapability, canGrantRole };
