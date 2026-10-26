// Refuses to go on unless this process is connected to the Neon branch named in DEV_BRANCH_ID.
// Tests and one-off scripts call it before touching the database, so they can never write to
// production. The running server never calls it — production has no DEV_BRANCH_ID.
async function assertDevBranch(prisma) {
  const expected = process.env.DEV_BRANCH_ID;
  if (!expected) throw new Error('DEV_BRANCH_ID is not set — refusing to touch the database.');
  const [row] = await prisma.$queryRawUnsafe("select current_setting('neon.branch_id', true) as branch");
  const actual = row && row.branch;
  if (actual !== expected) {
    throw new Error(`Connected to branch ${actual || 'unknown'}, not the dev branch ${expected} — refusing to go on.`);
  }
}

module.exports = { assertDevBranch };
