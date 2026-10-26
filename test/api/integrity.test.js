// Data integrity under real use, on the dev branch: simultaneous actions, barcode uniqueness,
// Maldives dates, and search as people type it.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, teardown, as } = require('./fixtures');
const { specimenPrefix } = require('../../src/utils/domain');

let fx;
before(async () => { fx = await setup(); });
after(teardown);

async function imported(token, codes) {
  const memoNumber = await fx.memo(codes);
  const res = await as(token).post('/api/orders/import', { memoNumber });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body;
}

describe('the server works on Maldives time', () => {
  it('runs in Indian/Maldives, so 21:00 UTC is already the next day', () => {
    assert.equal(process.env.TZ, 'Indian/Maldives');
    // 26 October 2026, 21:00 UTC is 27 October, 02:00 in Malé.
    assert.equal(specimenPrefix('B', new Date(Date.UTC(2026, 9, 26, 21, 0))), 'B261027');
  });
});

describe('barcodes', () => {
  it('six collections at the same moment all get different barcodes', async () => {
    const code = fx.catalog.hcLocal.code;
    const orders = [];
    for (let i = 0; i < 6; i++) orders.push(await imported(fx.tokens.hc, [code]));
    const results = await Promise.all(orders.map(o =>
      as(fx.tokens.hc).post(`/api/orders/${o.id}/collect`, { selectedCodes: [code], patientType: 'outpatient' })));
    for (const r of results) assert.equal(r.status, 200, JSON.stringify(r.body));
    const numbers = results.map(r => r.body.specimens[0].specimenNumber);
    assert.equal(new Set(numbers).size, numbers.length, `duplicates in ${numbers.join(', ')}`);
  });

  it('collecting the same order twice at once collects it once', async () => {
    const code = fx.catalog.hcLocal.code;
    const order = await imported(fx.tokens.hc, [code]);
    const [a, b] = await Promise.all([1, 2].map(() =>
      as(fx.tokens.hc).post(`/api/orders/${order.id}/collect`, { selectedCodes: [code], patientType: 'outpatient' })));
    assert.deepEqual([a.status, b.status].sort(), [200, 409]);
    const after = (await as(fx.tokens.hc).get(`/api/orders/${order.id}`)).body;
    assert.equal(after.specimens.length, 1);
  });
});

describe('two people deciding on the same tube', () => {
  it('only one accept goes through; the other is told', async () => {
    const code = fx.catalog.hcLocal.code;
    const order = await imported(fx.tokens.hc, [code]);
    const collected = (await as(fx.tokens.hc).post(`/api/orders/${order.id}/collect`, { selectedCodes: [code], patientType: 'outpatient' })).body;
    const num = collected.specimens[0].specimenNumber;
    const [a, b] = await Promise.all([
      as(fx.tokens.hc).post(`/api/specimens/${num}/accept`),
      as(fx.tokens.manager).post(`/api/specimens/${num}/accept`),
    ]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  });
});

describe("another facility's memo", () => {
  it('cannot be opened by fetching the same memo number', async () => {
    const order = await imported(fx.tokens.hc, [fx.catalog.hcLocal.code]);
    const res = await as(fx.tokens.atoll).post('/api/orders/import', { memoNumber: order.memoNumber });
    assert.equal(res.status, 409);
    assert.equal(res.body.patient, undefined);
  });
});

describe('patient search', () => {
  it('ignores upper and lower case', async () => {
    await imported(fx.tokens.hc, [fx.catalog.hcLocal.code]);
    const res = await as(fx.tokens.hc).get('/api/patients?query=zz%20test%20patient');
    assert.equal(res.status, 200);
    assert.ok(res.body.some(p => p.name === 'ZZ Test Patient'));
  });
});
