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

function matchRange(test, patient) {
  const age = calcAge(patient.dob);
  const sex = patient.sex;
  const ranges = test.refRanges || [];
  let candidates = ranges.filter(r => (r.sex === 'Any' || r.sex === sex) && age >= r.ageMin && age <= r.ageMax);
  if (!candidates.length) return null;
  candidates = candidates.slice().sort((a, b) => (a.sex === 'Any' ? 1 : 0) - (b.sex === 'Any' ? 1 : 0));
  return candidates[0];
}

function evalResult(test, patient, value) {
  const range = matchRange(test, patient);
  const v = parseFloat(value);
  if (!range) {
    return { flag: 'N/A', flagLabel: 'Not established', rangeText: 'Not established for age/sex' };
  }
  let flag = 'Normal';
  let flagLabel = 'Normal';
  if (test.criticalLow != null && v <= test.criticalLow) {
    flag = 'CriticalLow'; flagLabel = 'CRITICAL LOW';
  } else if (test.criticalHigh != null && v >= test.criticalHigh) {
    flag = 'CriticalHigh'; flagLabel = 'CRITICAL HIGH';
  } else if (v < range.low) {
    flag = 'Low'; flagLabel = 'Low';
  } else if (v > range.high) {
    flag = 'High'; flagLabel = 'High';
  }
  return { flag, flagLabel, rangeText: `${range.low} \u2013 ${range.high} ${test.units || ''}`.trim() };
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

module.exports = { TIER_RANK, needsReferral, referralTarget, calcAge, matchRange, evalResult, generateSpecimenNumber };
