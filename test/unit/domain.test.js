const test = require('node:test');
const assert = require('node:assert/strict');
const { matchRange, evalResult, numericValue, generateSpecimenNumber, formatAge, needsReferral, referralTarget } = require('../../src/utils/domain');

const range = (sex, ageMin, ageMax, ageUnit, low, high) => ({ sex, ageMin, ageMax, ageUnit, low, high });

test('matchRange includes both ends of an age band, counted in completed units', () => {
  const t = { refRanges: [range('Any', 0, 7, 'D', 1, 2), range('Any', 8, 365, 'D', 3, 4)] };
  const born = '2026-01-01';
  assert.equal(matchRange(t, { dob: born, sex: 'F' }, new Date(2026, 0, 8)).low, 1); // exactly 7 days old
  assert.equal(matchRange(t, { dob: born, sex: 'F' }, new Date(2026, 0, 9)).low, 3); // 8 days old
});

test('matchRange prefers a sex-specific band, then the finer unit', () => {
  const t = { refRanges: [range('Any', 0, 100, 'Y', 1, 2), range('M', 0, 100, 'Y', 3, 4), range('M', 0, 1200, 'M', 5, 6)] };
  assert.equal(matchRange(t, { dob: '2000-06-15', sex: 'M' }, new Date(2026, 5, 15)).low, 5);
  assert.equal(matchRange(t, { dob: '2000-06-15', sex: 'F' }, new Date(2026, 5, 15)).low, 1);
});

test('matchRange takes age on the collection date, not today', () => {
  const t = { refRanges: [range('Any', 0, 17, 'Y', 1, 2), range('Any', 18, 120, 'Y', 3, 4)] };
  const p = { dob: '2008-03-10', sex: 'F' };
  assert.equal(matchRange(t, p, new Date(2026, 2, 9)).low, 1); // the day before the 18th birthday
  assert.equal(matchRange(t, p, new Date(2026, 2, 10)).low, 3);
});

test('matchRange returns null when no band fits or the birth date is unreadable', () => {
  const t = { refRanges: [range('F', 18, 50, 'Y', 1, 2)] };
  assert.equal(matchRange(t, { dob: '1990-01-01', sex: 'M' }, new Date(2026, 0, 1)), null);
  assert.equal(matchRange(t, { dob: 'not a date', sex: 'F' }, new Date(2026, 0, 1)), null);
});

test('evalResult checks critical limits before the reference range, and without one', () => {
  const t = { units: 'mmol/L', criticalLow: 2.5, criticalHigh: 6.5, refRanges: [range('Any', 0, 120, 'Y', 3.5, 5.1)] };
  const p = { dob: '1980-01-01', sex: 'M' };
  assert.equal(evalResult(t, p, '6.5', new Date(2026, 0, 1)).flag, 'CriticalHigh');
  assert.equal(evalResult(t, p, '2.5', new Date(2026, 0, 1)).flag, 'CriticalLow');
  assert.equal(evalResult(t, p, '5.2', new Date(2026, 0, 1)).flag, 'High');
  assert.equal(evalResult(t, p, '3.4', new Date(2026, 0, 1)).flag, 'Low');
  assert.equal(evalResult(t, p, '4', new Date(2026, 0, 1)).flag, 'Normal');
  const noRange = { ...t, refRanges: [] };
  assert.equal(evalResult(noRange, p, '7', new Date(2026, 0, 1)).flag, 'CriticalHigh');
  assert.equal(evalResult(noRange, p, '4', new Date(2026, 0, 1)).flag, 'N/A');
});

test('evalResult gives a text result no flag rather than "Normal"', () => {
  const t = { refRanges: [range('Any', 0, 120, 'Y', 1, 2)] };
  assert.equal(evalResult(t, { dob: '1980-01-01', sex: 'F' }, 'Positive', new Date(2026, 0, 1)).flag, 'N/A');
});

test('numericValue reads an analyser limit such as "<0.05" or ">400" as its boundary', () => {
  assert.equal(numericValue('<0.05'), 0.05);
  assert.equal(numericValue('>= 400'), 400);
  assert.ok(Number.isNaN(numericValue('Positive')));
});

test('generateSpecimenNumber: letter, YY, unpadded month, DD, 4-digit sequence', () => {
  assert.equal(generateSpecimenNumber('H', 1001, new Date(2026, 7, 27)), 'H268271001');
  assert.equal(generateSpecimenNumber('b', 7, new Date(2026, 11, 3)), 'B2612030007');
  assert.equal(generateSpecimenNumber('', 1, new Date(2026, 0, 1)), 'X26101' + '0001');
});

test('formatAge shows days, then months, then years from age 2', () => {
  const now = new Date(2026, 5, 15);
  assert.equal(formatAge('2026-06-10', now), '5d');
  assert.equal(formatAge('2025-06-15', now), '12m');
  assert.equal(formatAge('2024-06-15', now), '2y');
});

test('referral goes to the parent atoll for atoll tests, and straight to Regional for regional tests', () => {
  const facilities = [
    { id: 'reg', tier: 'regional' },
    { id: 'at', tier: 'atoll' },
    { id: 'hc', tier: 'health_centre', parentAtollId: 'at' },
    { id: 'hc2', tier: 'health_centre', parentAtollId: null },
  ];
  const [, , hc, hc2] = facilities;
  assert.equal(needsReferral({ minTier: 'atoll' }, hc), true);
  assert.equal(needsReferral({ minTier: 'health_centre' }, hc), false);
  assert.equal(referralTarget({ minTier: 'atoll' }, hc, facilities).id, 'at');
  assert.equal(referralTarget({ minTier: 'atoll' }, hc2, facilities).id, 'reg');
  assert.equal(referralTarget({ minTier: 'regional' }, hc, facilities).id, 'reg');
});
