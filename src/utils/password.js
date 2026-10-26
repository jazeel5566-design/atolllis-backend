// Account-security rules, as set by the owner (2026-10-26). Keep the numbers in step with the
// login screen and user forms in public/index.html.
const PASSWORD_MIN_LENGTH = 10;
const MAX_FAILED_LOGINS = 5;  // wrong passwords in a row before the account locks
const LOCKOUT_MINUTES = 15;

// Why a new password is not acceptable, or null when it is.
function passwordProblem(password, username) {
  const pw = String(password || '');
  if (pw.length < PASSWORD_MIN_LENGTH) return `Password must be at least ${PASSWORD_MIN_LENGTH} characters`;
  if (username && pw.toLowerCase().includes(String(username).toLowerCase())) return 'Password must not contain the username';
  return null;
}

module.exports = { PASSWORD_MIN_LENGTH, MAX_FAILED_LOGINS, LOCKOUT_MINUTES, passwordProblem };
