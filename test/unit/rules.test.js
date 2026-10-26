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
