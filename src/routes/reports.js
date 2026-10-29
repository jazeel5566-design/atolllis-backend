const router = require('express').Router();
const prisma = require('../db');
const { requireAuth, requireCapability, userHasCapability } = require('../middleware/auth');
const { evalResult } = require('../utils/domain');
const { renderReportPdf } = require('../utils/report-pdf');
const { amendmentsFor, WITHDRAWN_TEXT } = require('../utils/amendment');
const { reportState, lastCertifiedAt } = require('../utils/report-status');
const { uid } = require('../utils/id');
const { logAudit } = require('../utils/audit');

router.use(requireAuth);

const NOT_FINAL = 'This report is not final yet. It can be opened and handed out when every test on the memo is finished.';

// Builds the report as the acting facility is allowed to see it. Returns { report } or
// { status, error }. Without seeUnfinished (no view_patient_records) only a final report is given.
async function buildReport(orderId, fid, { seeUnfinished }) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { tests: true, patient: true, orderingFacility: true, specimens: true, ward: true },
  });
  if (!order) return { status: 404, error: 'Not found' };

  // The ordering facility sees the whole report — its own tests and anything it referred out. A
  // reference lab sees only the tests it performs for this order, i.e. just its own sheet.
  const own = order.orderingFacilityId === fid;
  const relevantTests = order.tests.filter(t =>
    t.status !== 'deselected' && (own || (t.referred && t.performingFacilityId === fid))
  );
  if (!own && !relevantTests.length) {
    return { status: 403, error: 'This report is not available to your facility' };
  }
  const state = reportState(relevantTests);
  if (!seeUnfinished && state !== 'final') return { status: 403, error: NOT_FINAL };
  const codes = relevantTests.map(t => t.code);
  const catalogTests = await prisma.testDefinition.findMany({ where: { code: { in: codes } }, include: { refRanges: true } });
  const performingFacilities = await prisma.facility.findMany({ where: { id: { in: relevantTests.map(t => t.performingFacilityId) } } });

  // A result changed after it was certified carries its history, so the sheet can say it was amended.
  const amendments = await amendmentsFor(prisma, { orderTestId: { in: relevantTests.map(t => t.id) } });

  const lines = await Promise.all(relevantTests.map(async t => {
    const amended = amendments.get(t.id) || [];
    const tc = catalogTests.find(c => c.code === t.code);
    const pf = performingFacilities.find(f => f.id === t.performingFacilityId);
    const specimen = order.specimens.find(s => s.id === t.specimenId);
    const specimenNumber = specimen ? specimen.specimenNumber : null;
    if (t.status !== 'completed') {
      // A result that is entered but not yet certified is only "processing" to any other facility.
      const status = t.status === 'interfaced' && t.performingFacilityId !== fid ? 'processing' : t.status;
      return { code: t.code, name: t.name, method: tc ? tc.method : null, status, performingFacilityId: t.performingFacilityId, performingFacility: pf ? pf.name : null, referred: t.referred, specimenNumber, isStat: t.isStat, underAmendment: amended.length > 0 };
    }
    if (tc && tc.isCulture) {
      const cultureResult = await prisma.cultureResult.findUnique({
        where: { orderTestId: t.id },
        include: { organisms: { include: { organism: true, sensitivities: { include: { antibiotic: true } } } } },
      });
      return {
        code: t.code, name: t.name, method: tc.method, isCulture: true, cultureResult,
        performingFacilityId: t.performingFacilityId, performingFacility: pf ? pf.name : null, referred: t.referred, specimenNumber, isStat: t.isStat,
        validatedBy: t.validatedBy, validatedAt: t.validatedAt,
      };
    }
    const withdrawn = amended.length > 0 && amended[amended.length - 1].kind === 'withdrawn' && t.value === WITHDRAWN_TEXT;
    // Age for the reference range is taken on the day the specimen was collected.
    const info = tc && !withdrawn ? evalResult(tc, order.patient, t.value, specimen ? specimen.collectedAt : null) : { flag: 'N/A', flagLabel: '', rangeText: '' };
    return {
      code: t.code, name: t.name, method: tc ? tc.method : null, value: t.value, unit: t.unit,
      ...info,
      performingFacilityId: t.performingFacilityId, performingFacility: pf ? pf.name : null, referred: t.referred, specimenNumber, isStat: t.isStat,
      validatedBy: t.validatedBy, validatedAt: t.validatedAt, comment: tc ? tc.comment : null,
      criticalNotifiedTo: t.criticalNotifiedTo, criticalNotifiedAt: t.criticalNotifiedAt,
      amendments: amended, withdrawn,
    };
  }));

  // One sheet per lab that performs tests on this order, each under that lab's own header — the
  // ordering facility's sheet first, then one per reference lab. A sheet lists only the specimens
  // its own tests were run on.
  const sheets = [];
  relevantTests.forEach((t, i) => {
    let sheet = sheets.find(s => s.facility.id === t.performingFacilityId);
    if (!sheet) {
      const pf = performingFacilities.find(f => f.id === t.performingFacilityId);
      sheet = { facility: { id: t.performingFacilityId, name: pf ? pf.name : 'Unknown facility', nameDhivehi: pf ? pf.nameDhivehi : null, reportTitleDhivehi: pf ? pf.reportTitleDhivehi : null, reportNoteDhivehi: pf ? pf.reportNoteDhivehi : null }, isOrderingFacility: t.performingFacilityId === order.orderingFacilityId, specimenIds: new Set(), lines: [] };
      sheets.push(sheet);
    }
    sheet.lines.push(lines[i]);
    if (t.specimenId) sheet.specimenIds.add(t.specimenId);
  });
  sheets.sort((a, b) => (b.isOrderingFacility ? 1 : 0) - (a.isOrderingFacility ? 1 : 0));

  return { report: {
    state, lastCertifiedAt: lastCertifiedAt(relevantTests), own,
    order: { id: order.id, memoNumber: order.memoNumber, createdAt: order.createdAt, collectedAt: order.collectedAt, orderedBy: order.orderedBy },
    facility: { id: order.orderingFacilityId, name: order.orderingFacility.name }, // the ordering facility
    patient: order.patient,
    patientType: order.patientType,
    wardName: order.ward ? order.ward.name : null,
    sheets: sheets.map(s => ({
      facility: s.facility, isOrderingFacility: s.isOrderingFacility, lines: s.lines,
      amended: s.lines.some(l => l.amendments && l.amendments.length > 0),
      specimens: order.specimens.filter(sp => s.specimenIds.has(sp.id)).map(sp => ({ specimenNumber: sp.specimenNumber, bottleType: sp.bottleType })),
    })),
  } };
}

// ---------- Report desk: the work-list behind the Reports screen ----------
// The ordering facility's memos collected in the last DESK_DAYS days (or, with ?query=, any memo
// matching a memo, specimen, hospital or ID number or name), each with where its report stands and
// its hand-overs. The screen sorts them into "to hand out", "handed out" and "in the lab".
const DESK_DAYS = 30;

const isAbnormal = flag => !!flag && flag !== 'Normal' && flag !== 'N/A';

router.get('/desk', requireCapability('view_reports'), async (req, res) => {
  const fid = req.user.facilityId;
  const seeUnfinished = await userHasCapability(req.user, 'view_patient_records');
  const query = String(req.query.query || '').trim();
  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
  const where = { orderingFacilityId: fid, sampleStatus: { not: null } };
  if (query) {
    where.OR = [
      { memoNumber: { contains: query, mode: 'insensitive' } },
      { specimens: { some: { specimenNumber: { equals: query, mode: 'insensitive' } } } },
      { patient: { OR: [
        { name: { contains: query, mode: 'insensitive' } },
        { hospitalNumber: { contains: query, mode: 'insensitive' } },
        { idNumber: { contains: query, mode: 'insensitive' } },
      ] } },
    ];
  } else {
    where.OR = [
      { collectedAt: { gte: new Date(Date.now() - DESK_DAYS * 86400000) } },
      { handovers: { some: { facilityId: fid, handedAt: { gte: startOfToday } } } },
    ];
  }
  const orders = await prisma.order.findMany({
    where,
    include: { tests: true, patient: true, ward: true, specimens: { select: { id: true, specimenNumber: true, collectedAt: true } }, handovers: { where: { facilityId: fid }, orderBy: { handedAt: 'asc' } } },
    orderBy: { collectedAt: 'desc' },
    take: query ? 50 : undefined,
  });

  const allTests = orders.flatMap(o => o.tests.filter(t => t.status === 'completed'));
  const catalogTests = await prisma.testDefinition.findMany({ where: { code: { in: [...new Set(allTests.map(t => t.code))] } }, include: { refRanges: true } });
  const amended = new Set((await prisma.resultAmendment.findMany({ where: { orderTestId: { in: allTests.map(t => t.id) } }, select: { orderTestId: true } })).map(a => a.orderTestId));

  const items = orders.map(o => {
    const tests = o.tests.filter(t => t.status !== 'deselected');
    const actual = reportState(tests);
    const resultsShown = seeUnfinished || actual === 'final';
    const certifiedAt = lastCertifiedAt(tests);
    const handedOver = o.handovers.filter(h => h.kind === 'handover');
    const lastHandover = handedOver[handedOver.length - 1];
    const abnormal = resultsShown && tests.some(t => {
      if (t.status !== 'completed' || t.value === WITHDRAWN_TEXT) return false;
      const tc = catalogTests.find(c => c.code === t.code);
      const specimen = o.specimens.find(s => s.id === t.specimenId);
      return tc && isAbnormal(evalResult(tc, o.patient, t.value, specimen ? specimen.collectedAt : null).flag);
    });
    return {
      orderId: o.id, memoNumber: o.memoNumber, collectedAt: o.collectedAt, orderedBy: o.orderedBy,
      patientType: o.patientType, wardName: o.ward ? o.ward.name : null,
      patient: { id: o.patient.id, name: o.patient.name, nameDhivehi: o.patient.nameDhivehi, hospitalNumber: o.patient.hospitalNumber, idNumber: o.patient.idNumber, dob: o.patient.dob, sex: o.patient.sex },
      tests: tests.map(t => ({ name: t.name, status: t.status === 'interfaced' && t.performingFacilityId !== fid ? 'processing' : t.status })),
      specimens: o.specimens.map(s => s.specimenNumber),
      // Someone who may not see a preliminary report sees the memo as still in the lab.
      state: resultsShown ? actual : 'in_lab',
      abnormal,
      amended: resultsShown && tests.some(t => amended.has(t.id)),
      lastCertifiedAt: resultsShown ? certifiedAt : null,
      handovers: o.handovers.map(h => ({ kind: h.kind, receiverName: h.receiverName, receiverPhone: h.receiverPhone, handedBy: h.handedBy, handedAt: h.handedAt })),
      // Final and either never handed out, or changed (amended, or a test finished) since.
      due: actual === 'final' && (!lastHandover || (certifiedAt && lastHandover.handedAt < certifiedAt)),
      changedSinceHandover: actual === 'final' && !!lastHandover && !!certifiedAt && lastHandover.handedAt < certifiedAt,
    };
  });
  res.json({ days: DESK_DAYS, items });
});

// A final report printed and given to someone: their name and a contact number are required.
function cleanPhone(value) {
  const raw = String(value == null ? '' : value).trim();
  const digits = raw.replace(/[\s()-]/g, '');
  return /^\+?\d{7,15}$/.test(digits) ? digits : null;
}

async function orderForDesk(req) {
  const order = await prisma.order.findUnique({ where: { id: req.params.orderId }, include: { tests: true, patient: true, handovers: { where: { facilityId: req.user.facilityId }, orderBy: { handedAt: 'asc' } } } });
  if (!order || order.orderingFacilityId !== req.user.facilityId) return { error: [404, 'No report from your facility with that memo.'] };
  if (reportState(order.tests) !== 'final') return { error: [409, NOT_FINAL] };
  return { order };
}

router.post('/:orderId/handover', requireCapability('dispatch_reports'), async (req, res) => {
  const receiverName = String((req.body || {}).receiverName || '').replace(/\s+/g, ' ').trim();
  const receiverPhone = cleanPhone((req.body || {}).receiverPhone);
  if (!receiverName) return res.status(400).json({ error: "Enter the name of the person receiving the report." });
  if (receiverName.length > 100) return res.status(400).json({ error: 'The name is too long (at most 100 characters).' });
  if (!receiverPhone) return res.status(400).json({ error: 'Enter a contact number of at least 7 digits.' });
  const { order, error } = await orderForDesk(req);
  if (error) return res.status(error[0]).json({ error: error[1] });
  const handover = await prisma.reportHandover.create({
    data: { id: uid('HND'), orderId: order.id, facilityId: req.user.facilityId, kind: 'handover', receiverName, receiverPhone, handedBy: req.user.name, handedById: req.user.userId },
  });
  await logAudit(req.user, { action: 'report_handover', entityType: 'Order', entityId: order.id, details: `Handed the report for memo ${order.memoNumber} (${order.patient.name}) to ${receiverName}, ${receiverPhone}` });
  res.status(201).json(handover);
});

// Printing again a report that was already handed out. Recorded, so every copy is accounted for.
router.post('/:orderId/reprint', requireCapability('dispatch_reports'), async (req, res) => {
  const { order, error } = await orderForDesk(req);
  if (error) return res.status(error[0]).json({ error: error[1] });
  if (!order.handovers.some(h => h.kind === 'handover')) return res.status(409).json({ error: 'This report has not been handed out yet — record the hand-over instead.' });
  const reprint = await prisma.reportHandover.create({
    data: { id: uid('HND'), orderId: order.id, facilityId: req.user.facilityId, kind: 'reprint', handedBy: req.user.name, handedById: req.user.userId },
  });
  await logAudit(req.user, { action: 'report_reprint', entityType: 'Order', entityId: order.id, details: `Printed the report for memo ${order.memoNumber} (${order.patient.name}) again` });
  res.status(201).json(reprint);
});

// The report as a PDF, shown inline by the browser — one page (or more) per sheet.
router.get('/:orderId/pdf', requireCapability('view_reports'), async (req, res) => {
  const seeUnfinished = await userHasCapability(req.user, 'view_patient_records');
  const { report, status, error } = await buildReport(req.params.orderId, req.user.facilityId, { seeUnfinished });
  if (!report) return res.status(status).json({ error });
  const pdf = await renderReportPdf(report);
  const filename = `Report-${String(report.order.memoNumber || report.order.id).replace(/[^A-Za-z0-9_-]/g, '_')}.pdf`;
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${filename}"`, 'Cache-Control': 'no-store' });
  res.send(pdf);
});

router.get('/:orderId', requireCapability('view_reports'), async (req, res) => {
  const seeUnfinished = await userHasCapability(req.user, 'view_patient_records');
  const { report, status, error } = await buildReport(req.params.orderId, req.user.facilityId, { seeUnfinished });
  if (!report) return res.status(status).json({ error });
  if (report.own) {
    report.handovers = await prisma.reportHandover.findMany({ where: { orderId: report.order.id, facilityId: req.user.facilityId }, orderBy: { handedAt: 'asc' } });
  }
  res.json(report);
});

module.exports = router;
