const { evalResult } = require('./domain');

// What an amended result looks like to anyone allowed to see the result itself.
const describeAmendment = a => ({
  id: a.id, kind: a.kind, reason: a.reason,
  previousValue: a.previousValue, previousUnit: a.previousUnit, previousFlag: a.previousFlag,
  previousValidatedBy: a.previousValidatedBy, previousValidatedAt: a.previousValidatedAt,
  newValue: a.newValue, newUnit: a.newUnit, newFlag: a.newFlag,
  amendedBy: a.amendedBy, amendedAt: a.amendedAt,
  notifyRequired: a.notifyRequired, notifiedTo: a.notifiedTo, notifiedAt: a.notifiedAt,
});

const WITHDRAWN_TEXT = 'Result withdrawn';

function flagOf(testDefinition, patient, value, at) {
  if (!testDefinition || !patient || value == null) return 'N/A';
  return evalResult(testDefinition, patient, value, at).flag;
}

// Does the change alter what the result means to the clinician? Then someone has to be told.
// A withdrawal always does. So does any change of flag, and any change where a flag cannot be
// worked out for both values (a text result, or no reference range) — the system cannot show the
// meaning is unchanged, so it does not assume it.
function changesMeaning(kind, previousFlag, newFlag) {
  if (kind === 'withdrawn') return true;
  if (previousFlag === 'N/A' || newFlag === 'N/A') return true;
  return previousFlag !== newFlag;
}

// Amendments for a set of tests, oldest first, keyed by OrderTest id. `prisma` is passed in so
// this file stays free of the database client.
async function amendmentsFor(prisma, where) {
  const rows = await prisma.resultAmendment.findMany({ where, orderBy: { amendedAt: 'asc' } });
  const byTest = new Map();
  for (const a of rows) {
    if (!byTest.has(a.orderTestId)) byTest.set(a.orderTestId, []);
    byTest.get(a.orderTestId).push(describeAmendment(a));
  }
  return byTest;
}

module.exports = { amendmentsFor, describeAmendment, flagOf, changesMeaning, WITHDRAWN_TEXT };
