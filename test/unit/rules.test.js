const test = require('node:test');
const assert = require('node:assert/strict');
const { ipInCidr } = require('../../src/utils/cidr');
const { changesMeaning } = require('../../src/utils/amendment');
const { escalationLevel, minutesSince, CRITICAL_OVERDUE_MINUTES, CRITICAL_ESCALATE_MINUTES } = require('../../src/utils/critical');

test('ipInCidr matches ranges, single addresses and IPv4-mapped IPv6', () => {
  assert.equal(ipInCidr('203.0.113.42', '203.0.113.0/24'), true);
  assert.equal(ipInCidr('203.0.114.1', '203.0.113.0/24'), false);
  assert.equal(ipInCidr('::ffff:203.0.113.42', '203.0.113.42/32'), true);
  assert.equal(ipInCidr('203.0.113.42', '203.0.113.42'), true);
  assert.equal(ipInCidr('10.1.2.3', '0.0.0.0/0'), true);
});

test('ipInCidr rejects malformed input instead of matching it', () => {
  assert.equal(ipInCidr('300.1.1.1', '0.0.0.0/0'), false);
  assert.equal(ipInCidr('10.0.0.1', '10.0.0.0/33'), false);
  assert.equal(ipInCidr('', '10.0.0.0/8'), false);
  assert.equal(ipInCidr('2001:db8::1', '10.0.0.0/8'), false);
});

test('an amendment needs the clinician told when its meaning may have changed', () => {
  assert.equal(changesMeaning('withdrawn', 'Normal', 'N/A'), true);
  assert.equal(changesMeaning('corrected', 'Normal', 'High'), true);
  assert.equal(changesMeaning('corrected', 'N/A', 'N/A'), true); // text result: cannot show it is unchanged
  assert.equal(changesMeaning('corrected', 'High', 'High'), false);
});

test('critical escalation: pending, overdue at 30 minutes, escalated at 60', () => {
  assert.equal(CRITICAL_OVERDUE_MINUTES, 30);
  assert.equal(CRITICAL_ESCALATE_MINUTES, 60);
  assert.equal(escalationLevel(29), 'pending');
  assert.equal(escalationLevel(30), 'overdue');
  assert.equal(escalationLevel(60), 'escalated');
  const now = new Date('2026-10-26T10:45:30Z');
  assert.equal(minutesSince('2026-10-26T10:00:00Z', now), 45);
  assert.equal(minutesSince('2026-10-26T11:00:00Z', now), 0); // a clock ahead never goes negative
});

const { reportState, lastCertifiedAt } = require('../../src/utils/report-status');
const { visualOrder, cleanDhivehi } = require('../../src/utils/dhivehi');

test('a report is final only when every test is finished, preliminary when some are', () => {
  const t = status => ({ status });
  assert.equal(reportState([t('received'), t('interfaced')]), 'in_lab');
  assert.equal(reportState([t('completed'), t('processing')]), 'preliminary');
  assert.equal(reportState([t('completed'), t('rejected'), t('deselected')]), 'final');
  assert.equal(reportState([t('rejected')]), 'in_lab'); // nothing to report
  const a = new Date('2026-10-28T08:00:00Z'), b = new Date('2026-10-28T09:00:00Z');
  assert.equal(lastCertifiedAt([{ status: 'completed', validatedAt: a }, { status: 'completed', validatedAt: b }, { status: 'interfaced', validatedAt: null }]), b);
});

test('Dhivehi is drawn right to left, each letter keeping its vowel sign, numbers left as they are', () => {
  // ދި ވެ (dhi, ve) becomes ވެ ދި for drawing; "2026" stays "2026".
  assert.equal(visualOrder('ދިވެ'), 'ވެދި');
  assert.equal(visualOrder('ދި 2026'), '2026 ދި');
  assert.equal(visualOrder('(ދ)'), '(ދ)');
});

test('a Dhivehi field must be Thaana; empty means none', () => {
  assert.equal(cleanDhivehi('  ', 'Name', 50), null);
  assert.equal(cleanDhivehi(' ދި  ވެ ', 'Name', 50), 'ދި ވެ');
  assert.throws(() => cleanDhivehi('English', 'Name', 50), /Thaana/);
  assert.throws(() => cleanDhivehi('ދ'.repeat(51), 'Name', 50), /too long/);
});
