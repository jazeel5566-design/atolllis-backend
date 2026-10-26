const { specimenPrefix, generateSpecimenNumber } = require('./domain');

// The next barcode for this category letter on this date, taken in one statement: the database
// adds one to the prefix's counter (or starts it), so concurrent collections queue on that row and
// each gets its own number. A prefix's counter starts after the highest barcode already printed
// with it, so numbers issued before the counter existed are never handed out again. Pass the
// transaction client, so a collection that fails rolls its numbers back with everything else.
async function nextSpecimenNumber(tx, categoryLetter, date) {
  const prefix = specimenPrefix(categoryLetter, date);
  const rows = await tx.$queryRaw`
    INSERT INTO "SpecimenSequence" ("prefix", "last")
    VALUES (${prefix}, (
      SELECT COALESCE(MAX(CAST(SUBSTRING("specimenNumber" FROM ${prefix.length + 1}::int) AS INTEGER)), 0) + 1
      FROM "Specimen" WHERE "specimenNumber" LIKE ${prefix + '____'}
    ))
    ON CONFLICT ("prefix") DO UPDATE SET "last" = "SpecimenSequence"."last" + 1
    RETURNING "last"`;
  return generateSpecimenNumber(categoryLetter, rows[0].last, date);
}

module.exports = { nextSpecimenNumber };
