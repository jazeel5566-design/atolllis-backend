const crypto = require('crypto');
const prisma = require('../db');
const { uid } = require('./id');
const { logAudit } = require('./audit');
const { criticalFlagFor } = require('./critical');

// What the analyser interface does with a query or a result once the bridge has turned the
// instrument's protocol into plain fields. The same rules apply whichever protocol it came in on.

const hashKey = key => crypto.createHash('sha256').update(String(key)).digest('hex');
function newKey() {
  const key = 'alis_' + crypto.randomBytes(24).toString('hex');
  return { key, keyHash: hashKey(key), keyPrefix: key.slice(0, 10) };
}

const clean = v => (v === undefined || v === null ? '' : String(v).trim());
const sameUnit = (a, b) => clean(a).toLowerCase() === clean(b).toLowerCase();
const RAW_LIMIT = 4000;

// The audit log's actor for something an analyser did, not a person.
const actorFor = instrument => ({ userId: null, name: `${instrument.name} (analyser)`, facilityId: instrument.facilityId });

function logMessage(instrument, fields) {
  return prisma.interfaceMessage.create({
    data: {
      id: uid('IFM'), instrumentId: instrument.id, instrumentName: instrument.name, facilityId: instrument.facilityId,
      ...fields, raw: fields.raw ? String(fields.raw).slice(0, RAW_LIMIT) : null,
    },
  });
}

// The analyser has read a tube's barcode and asks what to run on it. Answers with the tests on
// that tube that this lab performs, are waiting, and are mapped to this instrument — and marks
// them 'processing', which is what "Load to Analyser" does by hand.
async function handleQuery(instrument, body) {
  const specimenNumber = clean(body.specimenNumber);
  const specimen = specimenNumber && await prisma.specimen.findUnique({
    where: { specimenNumber },
    include: { order: { include: { tests: true, patient: true } } },
  });
  if (!specimen) {
    await logMessage(instrument, { kind: 'query', specimenNumber: specimenNumber || null, status: 'unmatched', detail: 'No specimen with this barcode', raw: body.raw });
    return { specimenNumber, found: false, tests: [] };
  }
  const maps = await prisma.instrumentTestMap.findMany({ where: { instrumentId: instrument.id } });
  const waiting = specimen.order.tests.filter(t =>
    t.specimenId === specimen.id && t.performingFacilityId === instrument.facilityId
    && (t.status === 'received' || t.status === 'processing') && maps.some(m => m.testCode === t.code)
  );
  const toLoad = waiting.filter(t => t.status === 'received');
  if (toLoad.length) {
    await prisma.orderTest.updateMany({ where: { id: { in: toLoad.map(t => t.id) } }, data: { status: 'processing' } });
    await logAudit(actorFor(instrument), { action: 'load_analyser', entityType: 'Specimen', entityId: specimen.id, details: `Specimen ${specimen.specimenNumber} queried by analyser — ${toLoad.length} test(s) loaded` });
  }
  await logMessage(instrument, {
    kind: 'query', specimenNumber, status: 'accepted', raw: body.raw,
    detail: waiting.length ? `${waiting.length} test(s) sent: ${waiting.map(t => t.code).join(', ')}` : 'Nothing on this specimen is waiting for this analyser',
  });
  const p = specimen.order.patient;
  return {
    specimenNumber, found: true,
    patient: p ? { name: p.name, hospitalNumber: p.hospitalNumber, dob: p.dob, sex: p.sex } : null,
    tests: waiting.map(t => ({ instrumentCode: maps.find(m => m.testCode === t.code).instrumentCode, testCode: t.code, name: t.name, isStat: t.isStat })),
  };
}

// Decides what one result means without changing anything. Returns { status, detail } plus, when
// it can be written, { test, unit, criticalFlag, previousValue }.
async function placeResult(instrument, r) {
  const specimenNumber = clean(r.specimenNumber), instrumentCode = clean(r.instrumentCode), value = clean(r.value), unit = clean(r.unit);
  const hold = (detail, extra) => ({ status: 'unmatched', detail, ...extra });
  if (!instrumentCode) return hold('No test code sent');
  const map = await prisma.instrumentTestMap.findFirst({ where: { instrumentId: instrument.id, instrumentCode } });
  if (!map) return hold(`No test is mapped to analyser code "${instrumentCode}" on this instrument`);
  const known = { testCode: map.testCode };
  if (!value) return hold('No value sent', known);
  if (!specimenNumber) return hold('No specimen barcode sent', known);
  const specimen = await prisma.specimen.findUnique({ where: { specimenNumber }, include: { order: { include: { tests: true, patient: true } } } });
  if (!specimen) return hold('No specimen with this barcode', known);
  const test = specimen.order.tests.find(t => t.specimenId === specimen.id && t.code === map.testCode && t.performingFacilityId === instrument.facilityId);
  if (!test) return hold(`Test ${map.testCode} is not on this specimen at this lab`, known);
  known.orderTestId = test.id;
  const tc = await prisma.testDefinition.findUnique({ where: { code: map.testCode }, include: { refRanges: true } });
  if (!tc) return hold(`Test ${map.testCode} is not in the catalog`, known);
  if (tc.isCulture) return hold('Culture results are entered by hand, not through the interface', known);

  if (!unit) {
    if (!map.acceptBlankUnit) return hold(`Analyser sent no unit; expected "${map.units || tc.units || ''}"`, known);
  } else if (!(map.units && sameUnit(unit, map.units)) && !sameUnit(unit, tc.units)) {
    return hold(`Unit mismatch: analyser sent "${unit}", expected "${map.units || tc.units || ''}"`, known);
  }

  if (test.status === 'completed') return { status: 'refused', detail: 'Result already certified — not changed', ...known };
  let previousValue = null;
  if (test.status === 'interfaced') {
    if (clean(test.value) === value) return { status: 'duplicate', detail: 'Same value already on the test', ...known };
    const attempts = await prisma.criticalNotification.count({ where: { orderTestId: test.id } });
    if (attempts) return hold(`Rerun gives ${value}, but ${test.value} already has a critical notification on record — review by hand`, known);
    previousValue = test.value;
  } else if (test.status !== 'received' && test.status !== 'processing') {
    return hold(`Test is not ready for a result (status: ${test.status})`, known);
  }
  return {
    status: 'accepted', ...known, test, unit: tc.units, previousValue,
    criticalFlag: criticalFlagFor(tc, specimen.order.patient, value),
    detail: previousValue !== null ? `Rerun: replaced ${previousValue} with ${value}` : null,
  };
}

async function applyResult(instrument, placed, value) {
  await prisma.orderTest.update({
    where: { id: placed.test.id },
    data: { value, unit: placed.unit, status: 'interfaced', enteredAt: new Date(), enteredBy: `${instrument.name} (analyser)`, criticalFlag: placed.criticalFlag },
  });
  await logAudit(actorFor(instrument), {
    action: 'analyser_result', entityType: 'OrderTest', entityId: placed.test.id,
    details: `${placed.testCode}: ${value} ${placed.unit || ''} (from analyser${placed.previousValue !== null ? `, rerun — was ${placed.previousValue}` : ''})`,
  });
}

// One result from the analyser. QC and calibration material is recorded and goes no further.
async function handleResult(instrument, r) {
  const base = {
    specimenNumber: clean(r.specimenNumber) || null, instrumentCode: clean(r.instrumentCode) || null,
    value: clean(r.value) || null, unit: clean(r.unit) || null, flags: clean(r.flags) || null, raw: r.raw,
  };
  if (r.qc) {
    await logMessage(instrument, { ...base, kind: 'qc', status: 'logged', detail: 'QC / calibration result — not a patient result' });
    return { instrumentCode: base.instrumentCode, status: 'logged' };
  }
  const placed = await placeResult(instrument, r);
  if (placed.status === 'accepted') await applyResult(instrument, placed, base.value);
  await logMessage(instrument, {
    ...base, kind: 'result', status: placed.status, detail: placed.detail,
    testCode: placed.testCode || null, orderTestId: placed.orderTestId || null, previousValue: placed.previousValue || null,
  });
  return { instrumentCode: base.instrumentCode, testCode: placed.testCode || null, status: placed.status, detail: placed.detail || null };
}

// A person asks for a held result to be tried again, after fixing whatever stopped it (a missing
// mapping, a sample not yet received). It is judged by exactly the same rules as the first time.
async function retryMessage(message, user) {
  const instrument = await prisma.instrument.findUnique({ where: { id: message.instrumentId } });
  if (!instrument) return { status: 'unmatched', detail: 'The instrument this came from has been removed' };
  const placed = await placeResult(instrument, message);
  if (placed.status === 'unmatched') {
    await prisma.interfaceMessage.update({ where: { id: message.id }, data: { detail: placed.detail, testCode: placed.testCode || message.testCode, orderTestId: placed.orderTestId || null } });
    return { status: 'unmatched', detail: placed.detail };
  }
  if (placed.status === 'accepted') await applyResult(instrument, placed, clean(message.value));
  const outcome = { accepted: 'Accepted on retry', duplicate: 'Same value already on the test', refused: 'Result already certified — not changed' }[placed.status];
  await prisma.interfaceMessage.update({
    where: { id: message.id },
    data: {
      status: 'resolved', resolvedBy: user.name, resolvedAt: new Date(), resolveNote: placed.detail ? `${outcome} — ${placed.detail}` : outcome,
      testCode: placed.testCode || null, orderTestId: placed.orderTestId || null, previousValue: placed.previousValue || null,
    },
  });
  return { status: placed.status, detail: placed.detail || outcome };
}

module.exports = { hashKey, newKey, handleQuery, handleResult, retryMessage };
