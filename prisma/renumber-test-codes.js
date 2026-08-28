// One-off script — renumbers every test's code from the mnemonic strings (GLU, SERUMGLOBULI, ...)
// to real numeric codes. For tests imported from the IGMH file, this uses the ACTUAL hospital
// service code already stored as that test's HIS alias — so the catalog code and the real HIS
// code become the same number, which is exactly how a real hospital system works. The now-
// redundant alias (mapping a code to itself) is removed afterward.
//
// For tests that never had an alias (your original 6 demo tests: GLU, HGB, CREA, TSH, HBA1C,
// CA125), a fresh number is assigned starting at 9001 — a range unlikely to collide with any real
// IGMH code, so if you ever add more real codes later there's no ambiguity.
//
// This is a genuine multi-table update — every place a test's code is referenced gets moved to
// the new code, in a safe order (new row created and populated first, then every referencing row
// repointed, only then is the old row removed):
//   TestDefinition (+ nested ReferenceRange) -> OrderTest.code -> TestPanel.testCodes (JSON) ->
//   ReflexRule.triggerTestCode / resultTestCode -> TestAlias (old mapping removed)
//
// Usage:
//   1. Copy this file into your backend folder's prisma/ directory
//   2. node prisma/renumber-test-codes.js
//   3. rm prisma/renumber-test-codes.js

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const tests = await prisma.testDefinition.findMany({ include: { refRanges: true } });
  const aliases = await prisma.testAlias.findMany();
  console.log(`Found ${tests.length} test(s) to review.`);

  const codeMap = {}; // oldCode -> newCode
  let nextFallback = 9001;
  const usedNewCodes = new Set(aliases.map(a => a.hisCode));

  for (const t of tests) {
    const alias = aliases.find(a => a.internalCode === t.code);
    if (alias) {
      codeMap[t.code] = alias.hisCode;
    } else if (/^\d+$/.test(t.code)) {
      // Already numeric (e.g. a test added by hand after this point) — leave it alone.
      continue;
    } else {
      while (usedNewCodes.has(String(nextFallback))) nextFallback++;
      codeMap[t.code] = String(nextFallback);
      usedNewCodes.add(String(nextFallback));
      nextFallback++;
    }
  }

  const entries = Object.entries(codeMap);
  console.log(`${entries.length} test(s) will be renumbered.\n`);

  for (const [oldCode, newCode] of entries) {
    if (oldCode === newCode) continue;
    const existing = await prisma.testDefinition.findUnique({ where: { code: newCode } });
    if (existing) {
      console.log(`  SKIPPED ${oldCode} -> ${newCode}: a test already has code ${newCode}`);
      continue;
    }

    const t = tests.find(x => x.code === oldCode);

    // 1. Create the new row with the new code, copying every field.
    await prisma.testDefinition.create({
      data: {
        code: newCode, name: t.name, category: t.category, specimenType: t.specimenType,
        method: t.method, units: t.units, tat: t.tat, minTier: t.minTier,
        criticalLow: t.criticalLow, criticalHigh: t.criticalHigh, comment: t.comment,
        isCulture: t.isCulture,
        refRanges: { create: t.refRanges.map(r => ({ sex: r.sex, ageMin: r.ageMin, ageMax: r.ageMax, low: r.low, high: r.high })) },
      },
    });

    // 2. Repoint every table that references the old code.
    await prisma.orderTest.updateMany({ where: { code: oldCode }, data: { code: newCode } });

    const panels = await prisma.testPanel.findMany();
    for (const p of panels) {
      const codes = JSON.parse(p.testCodes);
      if (codes.includes(oldCode)) {
        await prisma.testPanel.update({
          where: { id: p.id },
          data: { testCodes: JSON.stringify(codes.map(c => c === oldCode ? newCode : c)) },
        });
      }
    }

    await prisma.reflexRule.updateMany({ where: { triggerTestCode: oldCode }, data: { triggerTestCode: newCode } });
    await prisma.reflexRule.updateMany({ where: { resultTestCode: oldCode }, data: { resultTestCode: newCode } });

    // 3. Remove the now-redundant alias (code now equals its own HIS code) and the old row.
    await prisma.testAlias.deleteMany({ where: { internalCode: oldCode } });
    await prisma.testDefinition.delete({ where: { code: oldCode } });

    console.log(`  ${oldCode} -> ${newCode}  (${t.name})`);
  }

  console.log('\nDone.');
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
