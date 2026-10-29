const { evalResult } = require('./domain');
const { amendmentsFor, WITHDRAWN_TEXT } = require('./amendment');
const { reportState, lastCertifiedAt } = require('./report-status');

// A patient's collected orders as one facility may see them — the visibility rule (CLAUDE.md):
// an order this facility placed, in full; otherwise only the tests referred to it. A result not yet
// certified shows as "processing" outside the lab that produced it. Without seeUnfinished (no
// view_patient_records), result values appear only once the order's report is final.
// Used by Patient History and the patient folder.
async function visibleOrdersForPatient(prisma, patient, fid, { seeUnfinished }) {
  const orders = await prisma.order.findMany({
    where: { patientId: patient.id, sampleStatus: { not: null } },
    include: { tests: true, specimens: true, ward: true },
    orderBy: { createdAt: 'desc' },
  });

  const visible = [];
  for (const o of orders) {
    const own = o.orderingFacilityId === fid;
    const tests = (own ? o.tests : o.tests.filter(t => t.referred && t.performingFacilityId === fid))
      .filter(t => t.status !== 'deselected');
    if (!tests.length) continue;
    const state = reportState(tests);
    const showResults = seeUnfinished || state === 'final';

    const catalogTests = await prisma.testDefinition.findMany({ where: { code: { in: tests.map(t => t.code) } }, include: { refRanges: true } });
    const amendments = showResults ? await amendmentsFor(prisma, { orderTestId: { in: tests.map(t => t.id) } }) : new Map();
    const lines = tests.map(t => {
      const specimen = o.specimens.find(s => s.id === t.specimenId);
      const specimenNumber = specimen ? specimen.specimenNumber : null;
      const tc = catalogTests.find(c => c.code === t.code);
      const category = tc ? tc.category : null;
      if (t.status !== 'completed' || !showResults) {
        const status = t.status === 'interfaced' && t.performingFacilityId !== fid ? 'processing' : t.status;
        return { code: t.code, name: t.name, category, status, specimenNumber, isStat: t.isStat };
      }
      const amended = amendments.get(t.id) || [];
      const withdrawn = amended.length > 0 && amended[amended.length - 1].kind === 'withdrawn' && t.value === WITHDRAWN_TEXT;
      const info = tc && !withdrawn ? evalResult(tc, patient, t.value, specimen ? specimen.collectedAt : null) : {};
      return { code: t.code, name: t.name, category, value: t.value, unit: t.unit, ...info, specimenNumber, isStat: t.isStat, validatedBy: t.validatedBy, validatedAt: t.validatedAt, amendments: amended, withdrawn };
    });
    visible.push({
      orderId: o.id, memoNumber: o.memoNumber, createdAt: o.createdAt, collectedAt: o.collectedAt, own,
      orderedBy: o.orderedBy, patientType: o.patientType, wardName: o.ward ? o.ward.name : null,
      state, lastCertifiedAt: lastCertifiedAt(tests), tests: lines,
    });
  }
  return visible;
}

module.exports = { visibleOrdersForPatient };
