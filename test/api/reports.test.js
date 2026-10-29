// The report desk on the dev branch: a preliminary report reaches clinicians and lab staff only;
// reception hands out final reports, with the receiver's name and number, and every copy is
// recorded; the patient folder follows the facility visibility rule and is audited.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, teardown, as, quietValue, prisma } = require('./fixtures');

let fx;
before(async () => { fx = await setup(); });
after(teardown);

const s = {};
const deskItem = async (token, orderId) => (await as(token).get('/api/reports/desk')).body.items.find(i => i.orderId === orderId);

describe('report desk', () => {
  before(async () => {
    const { hcLocal, hcLocal2 } = fx.catalog;
    s.first = hcLocal; s.second = hcLocal2;
    const memoNumber = await fx.memo([hcLocal.code, hcLocal2.code]);
    const imported = await as(fx.tokens.hc).post('/api/orders/import', { memoNumber });
    assert.equal(imported.status, 201, JSON.stringify(imported.body));
    s.orderId = imported.body.id;
    const collected = await as(fx.tokens.hc).post(`/api/orders/${s.orderId}/collect`, { selectedCodes: [hcLocal.code, hcLocal2.code], patientType: 'outpatient' });
    assert.equal(collected.status, 200, JSON.stringify(collected.body));
    s.patientId = collected.body.patientId;
    for (const sp of collected.body.specimens) {
      const res = await as(fx.tokens.hc).post(`/api/specimens/${sp.specimenNumber}/accept`);
      assert.equal(res.status, 200, JSON.stringify(res.body));
    }
    // One test finished; the other still in the lab.
    s.firstValue = quietValue(hcLocal);
    assert.equal((await as(fx.tokens.hc).post(`/api/tests/${s.orderId}/${hcLocal.code}/manual-result`, { value: s.firstValue })).status, 200);
    assert.equal((await as(fx.tokens.hc).post(`/api/tests/${s.orderId}/${hcLocal.code}/certify`)).status, 200);
  });

  it('a clinician sees the preliminary report; reception sees the memo as still in the lab', async () => {
    const clin = await deskItem(fx.tokens.clinician, s.orderId);
    assert.equal(clin.state, 'preliminary');
    assert.equal((await as(fx.tokens.clinician).get(`/api/reports/${s.orderId}`)).status, 200);

    const clerk = await deskItem(fx.tokens.clerk, s.orderId);
    assert.equal(clerk.state, 'in_lab');
    assert.equal(clerk.due, false);
    assert.equal(clerk.lastCertifiedAt, null);
    assert.equal((await as(fx.tokens.clerk).get(`/api/reports/${s.orderId}`)).status, 403);
    assert.equal((await as(fx.tokens.clerk).get(`/api/reports/${s.orderId}/pdf`)).status, 403);
  });

  it('no other route gives reception or a phlebotomist an unfinished result', async () => {
    for (const token of [fx.tokens.clerk, fx.tokens.phleb]) {
      const order = await as(token).get(`/api/orders/${s.orderId}`);
      assert.equal(order.status, 200);
      for (const t of order.body.tests) assert.equal(t.value, undefined);
      const hist = await as(token).get(`/api/history?query=${encodeURIComponent('ZZ Test Patient')}`);
      const entry = hist.body.flatMap(r => r.orders).find(o => o.orderId === s.orderId);
      for (const t of entry.tests) assert.equal(t.value, undefined);
    }
    const lab = await as(fx.tokens.hc).get(`/api/orders/${s.orderId}`);
    assert.equal(lab.body.tests.find(t => t.code === s.first.code).value, s.firstValue);
  });

  it('a hand-over is refused until the report is final', async () => {
    const res = await as(fx.tokens.clerk).post(`/api/reports/${s.orderId}/handover`, { receiverName: 'ZZ Receiver', receiverPhone: '7771234' });
    assert.equal(res.status, 409);
  });

  it('once final, reception sees the results and the report is due', async () => {
    assert.equal((await as(fx.tokens.hc).post(`/api/tests/${s.orderId}/${s.second.code}/manual-result`, { value: quietValue(s.second) })).status, 200);
    assert.equal((await as(fx.tokens.hc).post(`/api/tests/${s.orderId}/${s.second.code}/certify`)).status, 200);
    const item = await deskItem(fx.tokens.clerk, s.orderId);
    assert.equal(item.state, 'final');
    assert.equal(item.due, true);
    const report = await as(fx.tokens.clerk).get(`/api/reports/${s.orderId}`);
    assert.equal(report.status, 200);
    assert.equal(report.body.state, 'final');
    const pdf = await as(fx.tokens.clerk).get(`/api/reports/${s.orderId}/pdf`);
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers['content-type'], 'application/pdf');
  });

  it('a hand-over needs the receiver name and a contact number of at least 7 digits', async () => {
    const url = `/api/reports/${s.orderId}/handover`;
    assert.equal((await as(fx.tokens.clerk).post(url, { receiverName: '', receiverPhone: '7771234' })).status, 400);
    assert.equal((await as(fx.tokens.clerk).post(url, { receiverName: 'ZZ Receiver', receiverPhone: '12345' })).status, 400);
    assert.equal((await as(fx.tokens.clerk).post(url, { receiverName: 'ZZ Receiver', receiverPhone: 'call me' })).status, 400);
  });

  it('a clinician cannot hand a report out; reception can, and it is recorded', async () => {
    const url = `/api/reports/${s.orderId}/handover`;
    assert.equal((await as(fx.tokens.clinician).post(url, { receiverName: 'ZZ Receiver', receiverPhone: '777 1234' })).status, 403);
    const res = await as(fx.tokens.clerk).post(url, { receiverName: 'ZZ Receiver', receiverPhone: '777 1234' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.receiverPhone, '7771234');
    assert.equal(res.body.handedBy, 'ZZ Test clerk'); // from the login, never the request
    const item = await deskItem(fx.tokens.clerk, s.orderId);
    assert.equal(item.due, false);
    assert.equal(item.handovers.length, 1);
    const audit = await prisma.auditLog.findFirst({ where: { action: 'report_handover', entityId: s.orderId } });
    assert.ok(audit);
  });

  it('a reprint is recorded too, and only after a hand-over', async () => {
    const res = await as(fx.tokens.phleb).post(`/api/reports/${s.orderId}/reprint`);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const item = await deskItem(fx.tokens.clerk, s.orderId);
    assert.deepEqual(item.handovers.map(h => h.kind), ['handover', 'reprint']);
  });

  it('an amendment after hand-over makes the report due again', async () => {
    const t = fx.catalog.hcLocal;
    const corrected = (Number(s.firstValue) * 1.01 + 0.01).toFixed(2);
    const res = await as(fx.tokens.hc).post(`/api/tests/${s.orderId}/${t.code}/amend`, {
      action: 'correct', value: corrected, reason: 'ZZ test correction',
      notification: { personName: 'ZZ Test Clinician', method: 'phone', outcome: 'reached' },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const item = await deskItem(fx.tokens.clerk, s.orderId);
    assert.equal(item.due, true);
    assert.equal(item.changedSinceHandover, true);
    assert.equal(item.amended, true);
  });

  it('another facility cannot hand out or read this facility’s report desk entry', async () => {
    const res = await as(fx.tokens.atoll).post(`/api/reports/${s.orderId}/handover`, { receiverName: 'ZZ Receiver', receiverPhone: '7771234' });
    assert.equal(res.status, 404);
    const desk = await as(fx.tokens.atoll).get('/api/reports/desk');
    assert.equal(desk.body.items.some(i => i.orderId === s.orderId), false);
  });
});

describe('patient folder', () => {
  it('a clinician opens it, and the opening is audited', async () => {
    const res = await as(fx.tokens.clinician).get(`/api/patients/${s.patientId}/folder`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok(res.body.orders.some(o => o.orderId === s.orderId));
    const order = res.body.orders.find(o => o.orderId === s.orderId);
    assert.deepEqual(order.handovers.map(h => h.kind), ['handover', 'reprint']);
    const audit = await prisma.auditLog.findFirst({ where: { action: 'patient_folder_viewed', entityId: s.patientId } });
    assert.ok(audit);
  });

  it('reception has no folder; a facility with no records of the patient gets nothing', async () => {
    assert.equal((await as(fx.tokens.clerk).get(`/api/patients/${s.patientId}/folder`)).status, 403);
    assert.equal((await as(fx.tokens.atoll).get(`/api/patients/${s.patientId}/folder`)).status, 404);
  });

  it('the Dhivehi name must be Thaana; reception sets it, and it reaches the report', async () => {
    const url = `/api/patients/${s.patientId}/dhivehi-name`;
    assert.equal((await as(fx.tokens.clerk).put(url, { nameDhivehi: 'Latin letters' })).status, 400);
    const res = await as(fx.tokens.clerk).put(url, { nameDhivehi: 'ޓެސްޓް' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const report = await as(fx.tokens.clinician).get(`/api/reports/${s.orderId}`);
    assert.equal(report.body.patient.nameDhivehi, 'ޓެސްޓް');
    const pdf = await as(fx.tokens.clinician).get(`/api/reports/${s.orderId}/pdf`);
    assert.equal(pdf.status, 200);
  });
});
