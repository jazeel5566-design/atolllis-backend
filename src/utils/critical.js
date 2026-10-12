const { evalResult } = require('./domain');

// How long a critical (panic) value may sit without a successful notification before it is
// escalated. Counted from the moment the result was entered (OrderTest.enteredAt).
//   >= OVERDUE  : shown as Overdue to senior staff (anyone who can certify) at the performing lab
//   >= ESCALATE : additionally listed for the Regional administrator
const CRITICAL_OVERDUE_MINUTES = 30;
const CRITICAL_ESCALATE_MINUTES = 60;

const CRITICAL_FLAG_LABELS = { CriticalLow: 'CRITICAL LOW', CriticalHigh: 'CRITICAL HIGH' };

// 'CriticalLow' | 'CriticalHigh' | null — same evaluation the report uses, so the two never disagree.
function criticalFlagFor(testDefinition, patient, value) {
  if (!testDefinition || !patient) return null;
  const { flag } = evalResult(testDefinition, patient, value);
  return CRITICAL_FLAG_LABELS[flag] ? flag : null;
}

function minutesSince(from, now) {
  return Math.max(0, Math.floor(((now || new Date()) - new Date(from)) / 60000));
}

function escalationLevel(minutes) {
  if (minutes >= CRITICAL_ESCALATE_MINUTES) return 'escalated';
  if (minutes >= CRITICAL_OVERDUE_MINUTES) return 'overdue';
  return 'pending';
}

module.exports = { CRITICAL_OVERDUE_MINUTES, CRITICAL_ESCALATE_MINUTES, CRITICAL_FLAG_LABELS, criticalFlagFor, minutesSince, escalationLevel };
