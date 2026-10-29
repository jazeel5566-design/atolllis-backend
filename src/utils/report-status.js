// Where a memo's report stands, from the tests the viewer can see.
//   final       — every test has a certified result (or its sample was rejected), at least one result
//   preliminary — some results certified, others still in the lab
//   in_lab      — nothing certified yet
// Only a final report may be handed out. Before then, results are for people with
// view_patient_records (clinicians and lab staff); anyone else sees the memo as still in the lab.

const FINISHED = ['completed', 'rejected'];

function reportState(tests) {
  const live = tests.filter(t => t.status !== 'deselected');
  if (!live.some(t => t.status === 'completed')) return 'in_lab';
  return live.every(t => FINISHED.includes(t.status)) ? 'final' : 'preliminary';
}

// When the newest result on the report was certified (an amendment re-certifies, so it counts).
// A report handed out before this time has changed since and is due to be handed out again.
function lastCertifiedAt(tests) {
  let last = null;
  for (const t of tests) {
    if (t.status === 'completed' && t.validatedAt && (!last || t.validatedAt > last)) last = t.validatedAt;
  }
  return last;
}

// The result fields of a test, removed for a viewer who may not see results yet.
const RESULT_FIELDS = ['value', 'unit', 'criticalFlag', 'criticalNotifiedTo', 'criticalNotifiedAt', 'enteredBy', 'enteredAt'];
function withoutResult(t) {
  const copy = { ...t };
  for (const k of RESULT_FIELDS) delete copy[k];
  return copy;
}

module.exports = { reportState, lastCertifiedAt, withoutResult, FINISHED };
