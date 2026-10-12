const router = require('express').Router();
const prisma = require('../db');
const { requireAuth } = require('../middleware/auth');
const { evalResult } = require('../utils/domain');

router.use(requireAuth);

router.get('/:orderId', async (req, res) => {
  const order = await prisma.order.findUnique({
    where: { id: req.params.orderId },
    include: { tests: true, patient: true, orderingFacility: true, specimens: true, ward: true },
  });
  if (!order) return res.status(404).json({ error: 'Not found' });

  // The ordering facility sees the whole report — its own tests and anything it referred out. A
  // reference lab sees only the tests it performs for this order, i.e. just its own sheet.
  const fid = req.user.facilityId;
  const own = order.orderingFacilityId === fid;
  const relevantTests = order.tests.filter(t =>
    t.status !== 'deselected' && (own || (t.referred && t.performingFacilityId === fid))
  );
  if (!own && !relevantTests.length) {
    return res.status(403).json({ error: 'This report is not available to your facility' });
  }
  const codes = relevantTests.map(t => t.code);
  const catalogTests = await prisma.testDefinition.findMany({ where: { code: { in: codes } }, include: { refRanges: true } });
  const performingFacilities = await prisma.facility.findMany({ where: { id: { in: relevantTests.map(t => t.performingFacilityId) } } });

  const lines = await Promise.all(relevantTests.map(async t => {
    const tc = catalogTests.find(c => c.code === t.code);
    const pf = performingFacilities.find(f => f.id === t.performingFacilityId);
    const specimen = order.specimens.find(s => s.id === t.specimenId);
    const specimenNumber = specimen ? specimen.specimenNumber : null;
    if (t.status !== 'completed') {
      return { code: t.code, name: t.name, method: tc ? tc.method : null, status: t.status, performingFacilityId: t.performingFacilityId, performingFacility: pf ? pf.name : null, referred: t.referred, specimenNumber, isStat: t.isStat };
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
    const info = tc ? evalResult(tc, order.patient, t.value) : { flag: 'N/A', flagLabel: '', rangeText: '' };
    return {
      code: t.code, name: t.name, method: tc ? tc.method : null, value: t.value, unit: t.unit,
      ...info,
      performingFacilityId: t.performingFacilityId, performingFacility: pf ? pf.name : null, referred: t.referred, specimenNumber, isStat: t.isStat,
      validatedBy: t.validatedBy, validatedAt: t.validatedAt, comment: tc ? tc.comment : null,
      criticalNotifiedTo: t.criticalNotifiedTo, criticalNotifiedAt: t.criticalNotifiedAt,
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
      sheet = { facility: { id: t.performingFacilityId, name: pf ? pf.name : 'Unknown facility' }, isOrderingFacility: t.performingFacilityId === order.orderingFacilityId, specimenIds: new Set(), lines: [] };
      sheets.push(sheet);
    }
    sheet.lines.push(lines[i]);
    if (t.specimenId) sheet.specimenIds.add(t.specimenId);
  });
  sheets.sort((a, b) => (b.isOrderingFacility ? 1 : 0) - (a.isOrderingFacility ? 1 : 0));

  res.json({
    order: { id: order.id, memoNumber: order.memoNumber, createdAt: order.createdAt, orderedBy: order.orderedBy },
    facility: { id: order.orderingFacilityId, name: order.orderingFacility.name }, // the ordering facility
    patient: order.patient,
    patientType: order.patientType,
    wardName: order.ward ? order.ward.name : null,
    sheets: sheets.map(s => ({
      facility: s.facility, isOrderingFacility: s.isOrderingFacility, lines: s.lines,
      specimens: order.specimens.filter(sp => s.specimenIds.has(sp.id)).map(sp => ({ specimenNumber: sp.specimenNumber, bottleType: sp.bottleType })),
    })),
  });
});

module.exports = router;
