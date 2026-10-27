// Brings the PRODUCTION database onto Prisma migrations and applies any pending ones. The owner
// runs this, never Claude. The production address is passed for this one run only:
//
//   PROD_DATABASE_URL='postgresql://…(production, connection pooling OFF)…' node scripts/migrate-production.js
//
// It refuses the dev branch, shows what it is connected to, checks read-only that production still
// matches 0_baseline, and changes nothing until "yes" is typed. Safe to run again: steps already
// done are skipped.
require('dotenv').config();
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { PrismaClient } = require('@prisma/client');

const BASELINE_COMMIT = '73ab919'; // the commit that created 0_baseline from schema.prisma
const ORPHAN = '20260825120722_init';

const url = process.env.PROD_DATABASE_URL;
const ask = q => new Promise(r => { const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); rl.question(q, a => { rl.close(); r(a.trim()); }); });
const stop = msg => { console.error('\nSTOPPED: ' + msg); process.exit(1); };
// Prisma commands against production only: both addresses point there for the child process.
const prismaCli = args => execFileSync('npx', ['prisma', ...args], {
  env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
});

(async () => {
  if (!url) stop('set PROD_DATABASE_URL to the production address (Neon: Connect → production branch → connection pooling off).');
  if (new URL(url).hostname.includes('-pooler')) stop('that is the pooled address; switch connection pooling off in Neon and copy the address again.');

  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    const [{ branch }] = await prisma.$queryRawUnsafe("select current_setting('neon.branch_id', true) as branch");
    if (process.env.DEV_BRANCH_ID && branch === process.env.DEV_BRANCH_ID) stop('this is the dev branch, not production.');
    const [facilities, users, orders] = await Promise.all([prisma.facility.count(), prisma.user.count(), prisma.order.count()]);
    console.log(`Connected to Neon branch ${branch}: ${facilities} facilities, ${users} users, ${orders} orders.`);

    const applied = (await prisma.$queryRawUnsafe('select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null'))
      .map(r => r.migration_name);
    console.log('Migrations recorded there now:', applied.join(', ') || '(none)');
    const needsBaseline = !applied.includes('0_baseline');

    if (needsBaseline) {
      // Read-only: production must still be exactly the schema 0_baseline was made from.
      const baselineSchema = path.join(os.tmpdir(), 'atolllis-baseline-schema.prisma');
      fs.writeFileSync(baselineSchema, execFileSync('git', ['show', `${BASELINE_COMMIT}:prisma/schema.prisma`], { encoding: 'utf8' }));
      const drift = prismaCli(['migrate', 'diff', '--from-url', url, '--to-schema-datamodel', baselineSchema, '--script']);
      if (!/empty migration/i.test(drift)) {
        console.log(drift);
        stop('production differs from 0_baseline (shown above). Nothing was changed. Send this output to Claude.');
      }
      console.log('Read-only check passed: production matches 0_baseline exactly.');
    }

    const pending = fs.readdirSync(path.join(__dirname, '..', 'prisma', 'migrations'))
      .filter(d => !d.endsWith('.toml') && d !== '0_baseline' && !applied.includes(d));
    console.log('\nThis will:');
    if (needsBaseline && applied.includes(ORPHAN)) console.log(`  - remove the old bookkeeping record ${ORPHAN}`);
    if (needsBaseline) console.log('  - record 0_baseline as already applied (no tables change)');
    pending.forEach(d => console.log(`  - apply ${d}`));
    if (!needsBaseline && !pending.length) { console.log('  nothing — production is up to date.'); return; }

    if ((await ask('\nType yes to go ahead: ')) !== 'yes') stop('nothing was changed.');

    if (needsBaseline) {
      if (applied.includes(ORPHAN)) await prisma.$executeRawUnsafe(`delete from _prisma_migrations where migration_name = '${ORPHAN}'`);
      prismaCli(['migrate', 'resolve', '--applied', '0_baseline']);
      console.log('0_baseline recorded.');
    }
    console.log(prismaCli(['migrate', 'deploy']).split('\n').filter(l => /applied|migrat/i.test(l)).join('\n'));
    console.log(prismaCli(['migrate', 'status']).split('\n').filter(Boolean).slice(-2).join('\n'));
    console.log('\nDone. Production is on migrations and up to date.');
  } finally {
    await prisma.$disconnect();
  }
})().catch(e => stop(e.message.split('\n').slice(-3).join(' ')));
