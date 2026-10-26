const prisma = require('../db');

// Every action that writes more than once runs inside one of these: all of it is saved, or none.
// Inside, state changes are made conditional on the state that was checked (updateMany with the
// expected status, then a count check), so when two people act on the same record at once the
// second one waits, finds it changed, and gets a 409 instead of a half-finished double action.
// The limits are generous because each statement is a round trip to the database.
function inTransaction(fn) {
  return prisma.$transaction(fn, { maxWait: 10000, timeout: 30000 });
}

module.exports = { inTransaction };
