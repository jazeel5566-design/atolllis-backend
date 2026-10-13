const TIER_RANK = { health_centre: 1, atoll: 2, regional: 3 };

function needsReferral(test, facility) {
  return TIER_RANK[facility.tier] < TIER_RANK[test.minTier];
}

// Resolves which facility a test should be referred to, given the collecting facility.
// Atoll-level tests go to the collecting Health Centre's own parent Atoll Hospital — or straight
// to Regional if it has none. Regional-level tests always go straight to Regional, skipping Atoll.
function referralTarget(test, facility, allFacilities) {
  const regional = allFacilities.find(f => f.tier === 'regional');
  if (!test) return null;
  if (test.minTier === 'regional') return regional || null;
  if (test.minTier === 'atoll') {
    if (facility.parentAtollId) {
      const parent = allFacilities.find(f => f.id === facility.parentAtollId);
      if (parent) return parent;
    }
    return regional || null;
  }
  return null;
}

function calcAge(dob) {
  const d = new Date(dob);
  const n = new Date();
  let a = n.getFullYear() - d.getFullYear();
  const m = n.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && n.getDate() < d.getDate())) a--;
  return a;
}

// Age for display: whole years from 2 upward; months, then days, below that — "0y" tells a
// clinician nothing about a newborn. Keep in step with fmtAge() in public/index.html.
function formatAge(dob, now = new Date()) {
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return '?';
  let months = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
  if (now.getDate() < d.getDate()) months -= 1;
  if (months >= 24) return `${Math.floor(months / 12)}y`;
  if (months >= 1) return `${months}m`;
  return `${Math.max(0, Math.floor((now - d) / 86400000))}d`;
}

function matchRange(test, patient) {
  const age = calcAge(patient.dob);
  const sex = patient.sex;
  const ranges = test.refRanges || [];
  let candidates = ranges.filter(r => (r.sex === 'Any' || r.sex === sex) && age >= r.ageMin && age <= r.ageMax);
  if (!candidates.length) return null;
  candidates = candidates.slice().sort((a, b) => (a.sex === 'Any' ? 1 : 0) - (b.sex === 'Any' ? 1 : 0));
  return candidates[0];
}

// A result as a number, or NaN if it isn't one ("Positive", "No growth"). An analyser's "<0.05" or
// ">400" is read as its boundary, so a value reported as beyond a limit is still compared to it.
function numericValue(value) {
  return parseFloat(String(value ?? '').trim().replace(/^[<>\u2264\u2265]=?\s*/, ''));
}

// Keep in step with the copy of this function in public/index.html.
function evalResult(test, patient, value) {
  const range = matchRange(test, patient);
  const rangeText = range ? `${range.low} \u2013 ${range.high} ${test.units || ''}`.trim() : 'Not established for age/sex';
  const v = numericValue(value);
  // A text result can't be compared to anything — no flag, rather than a misleading "Normal".
  if (Number.isNaN(v)) return { flag: 'N/A', flagLabel: range ? '' : 'Not established', rangeText };

  // Critical limits are checked first and on their own: they belong to the test, not to a
  // reference range, so a panic value is still caught for a patient whose age/sex has no range.
  if (test.criticalLow != null && v <= test.criticalLow) return { flag: 'CriticalLow', flagLabel: 'CRITICAL LOW', rangeText };
  if (test.criticalHigh != null && v >= test.criticalHigh) return { flag: 'CriticalHigh', flagLabel: 'CRITICAL HIGH', rangeText };

  if (!range) return { flag: 'N/A', flagLabel: 'Not established', rangeText };
  if (v < range.low) return { flag: 'Low', flagLabel: 'Low', rangeText };
  if (v > range.high) return { flag: 'High', flagLabel: 'High', rangeText };
  return { flag: 'Normal', flagLabel: 'Normal', rangeText };
}

// Specimen barcode format: <category letter><YY><M, unpadded><DD, zero-padded><4-digit sequence>
// e.g. H268271001 = Hematology, 2026, August (8), the 27th, sequence 1001 for that category/day.
function generateSpecimenNumber(categoryLetter, sequence, date) {
  date = date || new Date();
  const letter = (categoryLetter || 'X').trim().charAt(0).toUpperCase() || 'X';
  const yy = String(date.getFullYear()).slice(-2);
  const m = String(date.getMonth() + 1); // month is intentionally NOT zero-padded
  const dd = String(date.getDate()).padStart(2, '0');
  const seq = String(sequence).padStart(4, '0');
  return `${letter}${yy}${m}${dd}${seq}`;
}

module.exports = { TIER_RANK, needsReferral, referralTarget, calcAge, formatAge, matchRange, numericValue, evalResult, generateSpecimenNumber };
