// One-off script — loads the common specimen rejection reasons into the RejectionReason list.
// Only adds names that aren't already there (compared case-insensitively); never edits or removes
// an existing reason, and touches no other table. Safe to run more than once. After this, the
// list is managed as usual under Settings → Rejection Reasons.
//
// Usage:
//   node prisma/load-rejection-reasons.js

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { uid } = require('../src/utils/id');
const prisma = new PrismaClient();

const REASONS = [
  'Hemolyzed',
  'Clotted',
  'Insufficient volume (QNS)',
  'Unlabelled specimen',
  'Mislabelled / patient details mismatch',
  'Wrong container / tube type',
  'Leaking or damaged container',
  'Lipemic',
  'Contaminated',
  'Delayed in transit / too old',
  'Improper storage or transport temperature',
  'Incorrect blood-to-anticoagulant ratio (under- or over-filled)',
];

async function main() {
  const existing = await prisma.rejectionReason.findMany();
  const have = new Set(existing.map(r => r.name.trim().toLowerCase()));
  console.log(`${existing.length} rejection reason(s) already in the list.`);

  let added = 0;
  for (const name of REASONS) {
    if (have.has(name.toLowerCase())) { console.log(`  = already there: ${name}`); continue; }
    await prisma.rejectionReason.create({ data: { id: uid('RR'), name } });
    console.log(`  + added: ${name}`);
    added += 1;
  }
  console.log(`\nDone — ${added} added, ${REASONS.length - added} already present.`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
