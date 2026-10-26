// Test fixtures on the dev branch: four accounts, one patient and the memos each scenario orders
// against, all marked "ZZ Test" / ZZTEST so nobody mistakes them for real records, and all removed
// again afterwards. Catalog tests are picked from the real catalog, never invented.
require('dotenv').config();
const bcrypt = require('bcryptjs');
const request = require('supertest');
const prisma = require('../../src/db');
const app = require('../../src/app');
const { uid } = require('../../src/utils/id');
const { assertDevBranch } = require('../../src/utils/db-guard');
const { matchRange } = require('../../src/utils/domain');

const PREFIX = 'ZZTEST-';
const USER_PREFIX = 'zz_test_';
const PASSWORD = 'zz-test-' + Date.now().toString(36);

async function removeTestData() {
  const users = await prisma.user.findMany({ where: { username: { startsWith: USER_PREFIX } }, select: { id: true } });
  const userIds = users.map(u => u.id);
  await prisma.order.deleteMany({ where: { memoNumber: { startsWith: PREFIX } } });
  await prisma.patient.deleteMany({ where: { hospitalNumber: { startsWith: PREFIX } } });
  await prisma.mockHisMemo.deleteMany({ where: { memoNumber: { startsWith: PREFIX } } });
  if (userIds.length) {
    await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
}

const PATIENT = { dob: '1980-05-20', sex: 'M' };

// A value that is inside this patient's reference range and clear of the critical limits, so a
// scenario that is not about flags never trips one.
function quietValue(t) {
  const r = matchRange(t, PATIENT, new Date());
  if (r) return String((r.low + r.high) / 2);
  if (t.criticalLow != null && t.criticalHigh != null) return String((t.criticalLow + t.criticalHigh) / 2);
  if (t.criticalHigh != null) return String(t.criticalHigh / 2);
  return '1';
}

async function pickCatalogTests() {
  const plain = { isCulture: false, active: true };
  const hcLocal = await prisma.testDefinition.findFirst({ where: { ...plain, minTier: 'health_centre' }, include: { refRanges: true } });
  const regional = await prisma.testDefinition.findFirst({ where: { ...plain, minTier: 'regional' }, include: { refRanges: true }, orderBy: { code: 'asc' } });
  const critical = await prisma.testDefinition.findFirst({ where: { ...plain, criticalHigh: { not: null } }, include: { refRanges: true } });
  const ranged = await prisma.testDefinition.findMany({ where: { ...plain, refRanges: { some: { sex: 'Any', ageUnit: 'Y', ageMin: { lte: 46 }, ageMax: { gte: 46 } } } }, include: { refRanges: true } });
  const amendable = ranged.find(t => t.criticalHigh == null) || ranged[0];
  const missing = Object.entries({ hcLocal, regional, critical, amendable }).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) throw new Error(`The dev catalog has no test suitable for: ${missing.join(', ')}`);
  return { hcLocal, regional, critical, amendable };
}

async function setup() {
  await assertDevBranch(prisma);
  await removeTestData(); // leftovers from a run that stopped halfway
  const suffix = Date.now().toString(36);
  const facilities = await prisma.facility.findMany();
  const byTier = tier => facilities.find(f => f.tier === tier);
  const hc = facilities.find(f => f.tier === 'health_centre' && f.parentAtollId);
  const atoll = hc && facilities.find(f => f.id === hc.parentAtollId);
  const regional = byTier('regional');
  if (!hc || !atoll || !regional) throw new Error('The dev branch needs a Regional Hospital and a Health Centre with a parent Atoll Hospital');

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const accounts = { hc: [hc, 'pathologist'], atoll: [atoll, 'pathologist'], regional: [regional, 'pathologist'], phleb: [hc, 'phlebotomist'] };
  const tokens = {};
  for (const [key, [facility, role]] of Object.entries(accounts)) {
    const username = `${USER_PREFIX}${key}_${suffix}`;
    const user = await prisma.user.create({ data: { name: `ZZ Test ${key}`, username, passwordHash, role, facilityId: facility.id } });
    await prisma.userFacilityAccess.create({ data: { id: uid('UFA'), userId: user.id, facilityId: facility.id } });
    const res = await request(app).post('/api/auth/login').send({ username, password: PASSWORD });
    if (res.status !== 200) throw new Error(`Test login failed for ${key}: ${res.status} ${JSON.stringify(res.body)}`);
    tokens[key] = res.body.token;
  }

  let memoCount = 0;
  async function memo(codes) {
    memoCount += 1;
    const memoNumber = `${PREFIX}${suffix}-${memoCount}`;
    await prisma.mockHisMemo.create({
      data: {
        memoNumber, source: 'HIS', orderedBy: 'ZZ Test Clinician',
        patientName: 'ZZ Test Patient', patientHospitalNumber: `${PREFIX}${suffix}`,
        patientDob: PATIENT.dob, patientSex: PATIENT.sex, testCodes: JSON.stringify(codes),
      },
    });
    return memoNumber;
  }

  return { facilities: { hc, atoll, regional }, tokens, catalog: await pickCatalogTests(), memo };
}

async function teardown() {
  try { await removeTestData(); } finally { await prisma.$disconnect(); }
}

// Thin wrappers so each step reads as the request it makes.
function as(token) {
  const auth = r => r.set('Authorization', `Bearer ${token}`);
  return {
    get: path => auth(request(app).get(path)),
    post: (path, body) => auth(request(app).post(path)).send(body || {}),
  };
}

module.exports = { setup, teardown, as, quietValue, PATIENT, prisma };
