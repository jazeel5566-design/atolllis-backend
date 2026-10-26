// End-to-end rules of the order pipeline, through the real API, on the dev branch: who may see
// what, who may change what, and the safety gates on results.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../../src/app');
const { setup, teardown, as, quietValue, PATIENT, prisma } = require('./fixtures');
const { matchRange, evalResult } = require('../../src/utils/domain');

let fx;
before(async () => { fx = await setup(); });
after(teardown);

const specimenOf = (order, code) => {
  const t = order.tests.find(x => x.code === code);
  return order.specimens.find(s => s.id === t.specimenId).specimenNumber;
};
const testOf = (order, code) => order.tests.find(x => x.code === code);

// Import a memo and collect every test on it, as the given facility.
async function importAndCollect(token, codes) {
  const memoNumber = await fx.memo(codes);
  const imported = await as(token).post('/api/orders/import', { memoNumber });
  assert.equal(imported.status, 201, JSON.stringify(imported.body));
  const collected = await as(token).post(`/api/orders/${imported.body.id}/collect`, { selectedCodes: codes, patientType: 'outpatient' });
  assert.equal(collected.status, 200, JSON.stringify(collected.body));
  return collected.body;
}

describe('authentication and permissions', () => {
  it('refuses a request with no login', async () => {
    const res = await request(app).get('/api/orders');
    assert.equal(res.status, 401);
  });

  it('refuses an action the role does not hold', async () => {
    const order = await importAndCollect(fx.tokens.hc, [fx.catalog.hcLocal.code]);
    const res = await as(fx.tokens.phleb).post(`/api/tests/${order.id}/${fx.catalog.hcLocal.code}/manual-result`, { value: '1' });
    assert.equal(res.status, 403);
  });
});

describe('referral and visibility between facilities', () => {
  const s = {};
  before(async () => {
    const { hcLocal, regional } = fx.catalog;
    s.codes = { local: hcLocal.code, ref: regional.code };
    s.memoNumber = await fx.memo([hcLocal.code, regional.code]);
    const imported = await as(fx.tokens.hc).post('/api/orders/import', { memoNumber: s.memoNumber });
    assert.equal(imported.status, 201, JSON.stringify(imported.body));
    s.orderId = imported.body.id;
  });

  it('another facility cannot collect this order', async () => {
    const res = await as(fx.tokens.atoll).post(`/api/orders/${s.orderId}/collect`, { selectedCodes: [s.codes.local] });
    assert.equal(res.status, 403);
  });

  it('collection keeps local tests here and readies regional tests for referral', async () => {
    const res = await as(fx.tokens.hc).post(`/api/orders/${s.orderId}/collect`, { selectedCodes: [s.codes.local, s.codes.ref], patientType: 'outpatient' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(testOf(res.body, s.codes.local).status, 'collected');
    assert.equal(testOf(res.body, s.codes.ref).status, 'awaiting_referral');
    for (const sp of res.body.specimens) assert.match(sp.specimenNumber, /^[A-Z]\d{9,10}$/); // YY + M (1-2 digits) + DD + 4-digit sequence
  });

  it('referral sends regional tests straight to the Regional Hospital', async () => {
    const res = await as(fx.tokens.hc).post(`/api/orders/${s.orderId}/refer`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const t = testOf(res.body.order, s.codes.ref);
    assert.equal(t.status, 'awaiting_receipt');
    assert.equal(t.performingFacilityId, fx.facilities.regional.id);
  });

  it('the reference lab sees only the test referred to it; an uninvolved lab sees nothing', async () => {
    const regional = await as(fx.tokens.regional).get(`/api/orders/${s.orderId}`);
    assert.equal(regional.status, 200);
    assert.deepEqual(regional.body.tests.map(t => t.code), [s.codes.ref]);
    const atoll = await as(fx.tokens.atoll).get(`/api/orders/${s.orderId}`);
    assert.equal(atoll.status, 403);
  });

  it('an unvalidated result shows as "processing" to everyone but the performing lab', async () => {
    const order = (await as(fx.tokens.hc).get(`/api/orders/${s.orderId}`)).body;
    const received = await as(fx.tokens.regional).post(`/api/specimens/${specimenOf(order, s.codes.ref)}/receive-referral`);
    assert.equal(received.status, 200, JSON.stringify(received.body));
    const entered = await as(fx.tokens.regional).post(`/api/tests/${s.orderId}/${s.codes.ref}/manual-result`, { value: quietValue(fx.catalog.regional) });
    assert.equal(entered.status, 200, JSON.stringify(entered.body));

    const atRegional = (await as(fx.tokens.regional).get(`/api/orders/${s.orderId}`)).body;
    assert.equal(testOf(atRegional, s.codes.ref).visibleStatus, 'interfaced');
    const atHc = (await as(fx.tokens.hc).get(`/api/orders/${s.orderId}`)).body;
    assert.equal(testOf(atHc, s.codes.ref).visibleStatus, 'processing');
  });

  it('only the performing lab can enter or certify a result', async () => {
    const enter = await as(fx.tokens.hc).post(`/api/tests/${s.orderId}/${s.codes.ref}/manual-result`, { value: '1' });
    assert.equal(enter.status, 404);
    const certify = await as(fx.tokens.hc).post(`/api/tests/${s.orderId}/${s.codes.ref}/certify`);
    assert.equal(certify.status, 404);
    const own = await as(fx.tokens.regional).post(`/api/tests/${s.orderId}/${s.codes.ref}/certify`);
    assert.equal(own.status, 200, JSON.stringify(own.body));
    assert.equal(own.body.status, 'completed');
  });

  it('only the ordering facility accepts its own specimen', async () => {
    const order = (await as(fx.tokens.hc).get(`/api/orders/${s.orderId}`)).body;
    const num = specimenOf(order, s.codes.local);
    const other = await as(fx.tokens.regional).post(`/api/specimens/${num}/accept`);
    assert.equal(other.status, 403);
    const own = await as(fx.tokens.hc).post(`/api/specimens/${num}/accept`);
    assert.equal(own.status, 200, JSON.stringify(own.body));
    assert.equal(own.body.status, 'received');
  });
});

describe('rejecting a referred specimen hands the test back for recollection', () => {
  const s = {};
  before(async () => {
    s.code = fx.catalog.regional.code;
    const order = await importAndCollect(fx.tokens.hc, [s.code]);
    s.orderId = order.id;
    const referred = await as(fx.tokens.hc).post(`/api/orders/${s.orderId}/refer`);
    assert.equal(referred.status, 200, JSON.stringify(referred.body));
    s.specimenNumber = specimenOf(referred.body.order, s.code);
    s.reason = await prisma.rejectionReason.findFirst({ where: { active: true } });
  });

  it('needs a reason, and an explanation when the reason is "Other"', async () => {
    const none = await as(fx.tokens.regional).post(`/api/specimens/${s.specimenNumber}/reject-referral`, {});
    assert.equal(none.status, 400);
    const other = await as(fx.tokens.regional).post(`/api/specimens/${s.specimenNumber}/reject-referral`, { reasonId: 'other' });
    assert.equal(other.status, 400);
  });

  it('returns the test to the ordering facility as rejected, and it can be recollected', async () => {
    const res = await as(fx.tokens.regional).post(`/api/specimens/${s.specimenNumber}/reject-referral`, { reasonId: s.reason.id });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const order = (await as(fx.tokens.hc).get(`/api/orders/${s.orderId}`)).body;
    const t = testOf(order, s.code);
    assert.equal(t.status, 'rejected');
    assert.equal(t.referred, false);
    assert.equal(t.performingFacilityId, fx.facilities.hc.id);
    const log = await prisma.specimenRejection.findFirst({ where: { specimen: { specimenNumber: s.specimenNumber } } });
    assert.equal(log.reasonId, s.reason.id);

    const again = await as(fx.tokens.hc).post(`/api/orders/${s.orderId}/recollect`, { testCodes: [s.code] });
    assert.equal(again.status, 200, JSON.stringify(again.body));
    assert.equal(testOf(again.body, s.code).status, 'awaiting_referral');
    assert.notEqual(specimenOf(again.body, s.code), s.specimenNumber);
  });
});

describe('a critical value cannot be certified until someone is reached', () => {
  const s = {};
  before(async () => {
    s.test = fx.catalog.critical;
    const order = await importAndCollect(fx.tokens.regional, [s.test.code]);
    s.orderId = order.id;
    const accepted = await as(fx.tokens.regional).post(`/api/specimens/${specimenOf(order, s.test.code)}/accept`);
    assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
    const entered = await as(fx.tokens.regional).post(`/api/tests/${s.orderId}/${s.test.code}/manual-result`, { value: String(s.test.criticalHigh) });
    assert.equal(entered.status, 200, JSON.stringify(entered.body));
    assert.equal(entered.body.criticalFlag, 'CriticalHigh');
  });

  const call = outcome => ({ personName: 'ZZ Test Clinician', personRole: 'Ordering clinician', method: 'phone', outcome, readBack: outcome === 'reached' });

  it('blocks certification while nobody has been told', async () => {
    const res = await as(fx.tokens.regional).post(`/api/tests/${s.orderId}/${s.test.code}/certify`);
    assert.equal(res.status, 400);
    assert.equal(res.body.requiresCriticalNotification, true);
  });

  it('a failed call is recorded but does not unblock it', async () => {
    const attempt = await as(fx.tokens.regional).post(`/api/tests/${s.orderId}/${s.test.code}/critical-notification`, call('not_reached'));
    assert.equal(attempt.status, 201, JSON.stringify(attempt.body));
    const res = await as(fx.tokens.regional).post(`/api/tests/${s.orderId}/${s.test.code}/certify`);
    assert.equal(res.status, 400);
  });

  it('once someone is reached, it can be certified', async () => {
    const attempt = await as(fx.tokens.regional).post(`/api/tests/${s.orderId}/${s.test.code}/critical-notification`, call('reached'));
    assert.equal(attempt.status, 201, JSON.stringify(attempt.body));
    const res = await as(fx.tokens.regional).post(`/api/tests/${s.orderId}/${s.test.code}/certify`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.status, 'completed');
    const attempts = await prisma.criticalNotification.count({ where: { orderTest: { orderId: s.orderId } } });
    assert.equal(attempts, 2);
  });
});

describe('amending a certified result keeps the original', () => {
  const s = {};
  before(async () => {
    s.test = fx.catalog.amendable;
    const order = await importAndCollect(fx.tokens.regional, [s.test.code]);
    s.orderId = order.id;
    await as(fx.tokens.regional).post(`/api/specimens/${specimenOf(order, s.test.code)}/accept`);
    s.original = quietValue(s.test);
    await as(fx.tokens.regional).post(`/api/tests/${s.orderId}/${s.test.code}/manual-result`, { value: s.original });
    const certified = await as(fx.tokens.regional).post(`/api/tests/${s.orderId}/${s.test.code}/certify`);
    assert.equal(certified.status, 200, JSON.stringify(certified.body));
    // A corrected value just above the range, but below any critical limit.
    const r = matchRange(s.test, PATIENT, new Date());
    let high = r.high + (r.high - r.low) * 0.25;
    if (s.test.criticalHigh != null) high = Math.min(high, (r.high + s.test.criticalHigh) / 2);
    s.corrected = String(Number(high.toFixed(3)));
    assert.equal(evalResult(s.test, PATIENT, s.corrected, new Date()).flag, 'High');
  });

  it('refuses a "correction" to the same value, or with no reason', async () => {
    const same = await as(fx.tokens.regional).post(`/api/tests/${s.orderId}/${s.test.code}/amend`, { action: 'correct', value: s.original, reason: 'ZZ test correction' });
    assert.equal(same.status, 400);
    const noReason = await as(fx.tokens.regional).post(`/api/tests/${s.orderId}/${s.test.code}/amend`, { action: 'correct', value: s.corrected });
    assert.equal(noReason.status, 400);
  });

  it('a change of flag needs a record of who was told', async () => {
    const res = await as(fx.tokens.regional).post(`/api/tests/${s.orderId}/${s.test.code}/amend`, { action: 'correct', value: s.corrected, reason: 'ZZ test correction' });
    assert.equal(res.status, 400);
    assert.equal(res.body.requiresNotification, true);
  });

  it('stores the first-reported value and who validated it, and shows the new one', async () => {
    const res = await as(fx.tokens.regional).post(`/api/tests/${s.orderId}/${s.test.code}/amend`, {
      action: 'correct', value: s.corrected, reason: 'ZZ test correction',
      notification: { personName: 'ZZ Test Clinician', method: 'phone', outcome: 'reached' },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.value, s.corrected);
    assert.equal(res.body.status, 'completed');
    const row = await prisma.resultAmendment.findFirst({ where: { orderTest: { orderId: s.orderId } } });
    assert.equal(row.previousValue, s.original);
    assert.equal(row.previousFlag, 'Normal');
    assert.equal(row.newFlag, 'High');
    assert.ok(row.previousValidatedBy);
    assert.ok(row.notifiedAt);
  });

  it('another lab cannot amend it', async () => {
    const res = await as(fx.tokens.hc).post(`/api/tests/${s.orderId}/${s.test.code}/amend`, { action: 'withdraw', reason: 'ZZ test withdrawal' });
    assert.equal(res.status, 404);
  });
});
