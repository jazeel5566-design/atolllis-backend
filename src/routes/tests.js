const router = require('express').Router();
const prisma = require('../db');
const { requireAuth, requireCapability } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');
const { uid } = require('../utils/id');
const {
  CRITICAL_OVERDUE_MINUTES, CRITICAL_ESCALATE_MINUTES, CRITICAL_FLAG_LABELS, criticalFlagFor, minutesSince, escalationLevel,
} = require('../utils/critical');
const { describeAmendment, flagOf, changesMeaning, WITHDRAWN_TEXT } = require('../utils/amendment');
const { inTransaction } = require('../utils/transaction');
const { HttpError } = require('../utils/http-error');

const CHANGED_MEANWHILE = 'This result was changed by someone else meanwhile — reload to see it.';

router.use(requireAuth);

// ---------- Critical (panic) values ----------
// The flag for a just-entered value, looked up against the catalog and this order's patient.
async function criticalFlagForEntry(orderId, code, value) {
  const [tc, order] = await Promise.all([
    prisma.testDefinition.findUnique({ where: { code }, include: { refRanges: true } }),
    prisma.order.findUnique({ where: { id: orderId }, include: { patient: true } }),
  ]);
  return criticalFlagFor(tc, order && order.patient, value);
}

// The stored snapshot wins; a result entered before the snapshot existed is evaluated on the spot.
async function criticalFlagOf(t) {
  return t.criticalFlag || criticalFlagForEntry(t.orderId, t.code, t.value);
}

async function canHandleCriticals(role) {
  const match = await prisma.roleCapability.findFirst({ where: { role, capability: { in: ['process', 'certify'] } } });
  return !!match;
}

function parseDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

const describeAttempt = a => ({
  personName: a.personName, personRole: a.personRole, method: a.method, outcome: a.outcome,
  readBack: a.readBack, note: a.note, recordedBy: a.recordedBy, createdAt: a.createdAt,
});

// Critical results at this lab that nobody has been successfully told about yet, oldest first, each
// with how long it has waited and its escalation level. The Regional administrator additionally
// gets `escalated`: results past the second limit at any other lab — identified by lab, test and
// memo only, never the value or the patient, since an uncertified result stays inside the lab
// that produced it.
router.get('/critical', async (req, res) => {
  const fid = req.user.facilityId;
  const now = new Date();
  const limits = { overdueMinutes: CRITICAL_OVERDUE_MINUTES, escalateMinutes: CRITICAL_ESCALATE_MINUTES };

  let items = [];
  if (await canHandleCriticals(req.user.role)) {
    const waiting = await prisma.orderTest.findMany({
      where: { performingFacilityId: fid, status: 'interfaced', criticalNotifiedAt: null },
      include: {
        order: { include: { patient: true, orderingFacility: { select: { name: true } }, ward: true } },
        specimen: true,
        criticalNotifications: { orderBy: { createdAt: 'asc' } },
      },
      orderBy: { enteredAt: 'asc' },
    });
    const unflagged = waiting.filter(t => !t.criticalFlag);
    const catalog = unflagged.length
      ? await prisma.testDefinition.findMany({ where: { code: { in: unflagged.map(t => t.code) } }, include: { refRanges: true } })
      : [];
    items = waiting
      .map(t => {
        const flag = t.criticalFlag || criticalFlagFor(catalog.find(c => c.code === t.code), t.order.patient, t.value);
        if (!flag) return null;
        const minutes = minutesSince(t.enteredAt, now);
        return {
          orderId: t.orderId, code: t.code, name: t.name, value: t.value, unit: t.unit,
          flag, flagLabel: CRITICAL_FLAG_LABELS[flag],
          enteredAt: t.enteredAt, enteredBy: t.enteredBy, minutes, level: escalationLevel(minutes),
          memoNumber: t.order.memoNumber, orderedBy: t.order.orderedBy,
          specimenNumber: t.specimen ? t.specimen.specimenNumber : null,
          referred: t.referred, orderingFacilityName: t.order.orderingFacility.name,
          patientType: t.order.patientType, wardName: t.order.ward ? t.order.ward.name : null,
          patient: { name: t.order.patient.name, hospitalNumber: t.order.patient.hospitalNumber },
          // After an amendment the clock restarts — earlier calls were about the earlier value.
          attempts: t.criticalNotifications.filter(n => !t.enteredAt || n.createdAt >= t.enteredAt).map(describeAttempt),
        };
      })
      .filter(Boolean);
  }

  let escalated = [];
  if (req.user.role === 'admin' && req.user.tier === 'regional') {
    const cutoff = new Date(now.getTime() - CRITICAL_ESCALATE_MINUTES * 60000);
    const late = await prisma.orderTest.findMany({
      where: {
        status: 'interfaced', criticalFlag: { not: null }, criticalNotifiedAt: null,
        enteredAt: { lte: cutoff }, performingFacilityId: { not: fid },
      },
      include: { order: { select: { memoNumber: true } }, specimen: true, performingFacility: { select: { name: true } }, criticalNotifications: true },
      orderBy: { enteredAt: 'asc' },
    });
    escalated = late.map(t => ({
      facilityName: t.performingFacility.name, code: t.code, name: t.name,
      flag: t.criticalFlag, flagLabel: CRITICAL_FLAG_LABELS[t.criticalFlag] || 'CRITICAL',
      memoNumber: t.order.memoNumber, specimenNumber: t.specimen ? t.specimen.specimenNumber : null,
      enteredAt: t.enteredAt, minutes: minutesSince(t.enteredAt, now), attempts: t.criticalNotifications.length,
    }));
  }

  res.json({ ...limits, items, escalated });
});

// Critical value log for this lab: every critical result it produced in the period, how long the
// notification took, and each attempt made. Optional ?from=&to= (ISO timestamps) on enteredAt.
router.get('/critical-log', async (req, res) => {
  if (!(await canHandleCriticals(req.user.role))) return res.json([]);
  const from = parseDate(req.query.from);
  const to = parseDate(req.query.to);
  const now = new Date();

  const tests = await prisma.orderTest.findMany({
    where: {
      performingFacilityId: req.user.facilityId,
      status: { in: ['interfaced', 'completed'] },
      OR: [{ criticalFlag: { not: null } }, { criticalNotifiedAt: { not: null } }],
      ...(from || to ? { enteredAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    },
    include: { order: { include: { patient: true } }, specimen: true, criticalNotifications: { orderBy: { createdAt: 'asc' } } },
    orderBy: { enteredAt: 'desc' },
  });

  res.json(tests.map(t => {
    const notified = !!t.criticalNotifiedAt;
    const minutes = notified ? minutesSince(t.enteredAt, t.criticalNotifiedAt) : minutesSince(t.enteredAt, now);
    return {
      orderId: t.orderId, code: t.code, name: t.name, value: t.value, unit: t.unit,
      flag: t.criticalFlag, flagLabel: CRITICAL_FLAG_LABELS[t.criticalFlag] || 'CRITICAL',
      enteredAt: t.enteredAt, enteredBy: t.enteredBy,
      memoNumber: t.order.memoNumber, specimenNumber: t.specimen ? t.specimen.specimenNumber : null,
      patient: { name: t.order.patient.name, hospitalNumber: t.order.patient.hospitalNumber },
      notified, notifiedTo: t.criticalNotifiedTo, notifiedAt: t.criticalNotifiedAt,
      minutes, onTime: notified && minutes < CRITICAL_OVERDUE_MINUTES,
      attempts: t.criticalNotifications.map(describeAttempt),
    };
  }));
});

// Record one attempt to notify someone of a critical value — made by the lab that produced the
// result. A 'reached' attempt is what stops the escalation clock and unlocks certification;
// 'not_reached' just adds to the trail.
router.post('/:orderId/:code/critical-notification', requireCapability('process'), async (req, res) => {
  const { orderId, code } = req.params;
  const body = req.body || {};
  const personName = (body.personName || '').trim();
  const personRole = (body.personRole || '').trim() || null;
  const note = (body.note || '').trim() || null;
  if (!personName) return res.status(400).json({ error: 'personName is required — who was called?' });
  if (!['phone', 'in_person'].includes(body.method)) return res.status(400).json({ error: 'method must be phone or in_person' });
  if (!['reached', 'not_reached'].includes(body.outcome)) return res.status(400).json({ error: 'outcome must be reached or not_reached' });
  const reached = body.outcome === 'reached';

  const t = await prisma.orderTest.findFirst({ where: { orderId, code } });
  if (!t || t.performingFacilityId !== req.user.facilityId) return res.status(404).json({ error: 'Not found' });
  if (t.status !== 'interfaced') return res.status(409).json({ error: `Test is not awaiting validation (status: ${t.status})` });
  if (t.criticalNotifiedAt) return res.status(409).json({ error: `Already notified: ${t.criticalNotifiedTo}` });
  const flag = await criticalFlagOf(t);
  if (!flag) return res.status(409).json({ error: 'This result is not a critical value' });

  const facility = await prisma.facility.findUnique({ where: { id: req.user.facilityId }, select: { name: true } });
  const who = personRole ? `${personName} (${personRole})` : personName;
  const { attempt, updated } = await inTransaction(async tx => {
    const attempt = await tx.criticalNotification.create({
      data: {
        id: uid('CRN'), orderTestId: t.id,
        facilityId: req.user.facilityId, facilityName: facility ? facility.name : 'Unknown',
        personName, personRole, method: body.method, outcome: body.outcome,
        readBack: reached && !!body.readBack, note, recordedBy: req.user.name,
      },
    });
    if (!reached) return { attempt, updated: t };
    const marked = await tx.orderTest.updateMany({
      where: { id: t.id, status: 'interfaced', criticalNotifiedAt: null },
      data: { criticalFlag: flag, criticalNotifiedTo: who, criticalNotifiedAt: attempt.createdAt },
    });
    if (!marked.count) throw new HttpError(409, CHANGED_MEANWHILE);
    // If this value is itself a correction of an earlier report, the same call covers telling them.
    await tx.resultAmendment.updateMany({
      where: { orderTestId: t.id, notifyRequired: true, notifiedAt: null },
      data: { notifiedTo: who, notifiedMethod: body.method, notifiedAt: attempt.createdAt, notifiedBy: req.user.name },
    });
    return { attempt, updated: await tx.orderTest.findUnique({ where: { id: t.id } }) };
  });
  await logAudit(req.user, {
    action: reached ? 'critical_notified' : 'critical_attempt_failed', entityType: 'OrderTest', entityId: t.id,
    details: `${code}: ${t.value} ${CRITICAL_FLAG_LABELS[flag]} — ${reached ? 'notified' : 'could not reach'} ${who} after ${minutesSince(t.enteredAt, attempt.createdAt)} min`,
  });
  res.status(201).json({ ...updated, attempt: describeAttempt(attempt) });
});

// Manual entry by a person — unit is fixed to the catalog default, so no mismatch is possible. Also
// allowed for a test already loaded to an analyser ('processing'), for when the instrument cannot
// report it. Results from an analyser itself arrive through /api/interface (routes/interface.js),
// never through a user session, so the audit trail always says truthfully which it was.
router.post('/:orderId/:code/manual-result', requireCapability('process'), async (req, res) => {
  const { orderId, code } = req.params;
  const { value } = req.body || {};
  if (value === undefined || value === '') return res.status(400).json({ error: 'value is required' });

  const t = await prisma.orderTest.findFirst({ where: { orderId, code } });
  if (!t || t.performingFacilityId !== req.user.facilityId) return res.status(404).json({ error: 'Not found' });
  if (t.status !== 'received' && t.status !== 'processing') return res.status(409).json({ error: `Test is not awaiting a result (status: ${t.status})` });

  const tc = await prisma.testDefinition.findUnique({ where: { code } });
  const criticalFlag = await criticalFlagForEntry(orderId, code, value);
  const entered = await prisma.orderTest.updateMany({
    where: { id: t.id, status: { in: ['received', 'processing'] } },
    data: { value: String(value), unit: tc ? tc.units : null, status: 'interfaced', enteredAt: new Date(), enteredBy: req.user.name, criticalFlag },
  });
  if (!entered.count) return res.status(409).json({ error: CHANGED_MEANWHILE });
  const updated = await prisma.orderTest.findUnique({ where: { id: t.id } });
  await logAudit(req.user, { action: 'manual_result', entityType: 'OrderTest', entityId: t.id, details: `${code}: ${value} (manual entry)` });
  res.json(updated);
});

// Culture & sensitivity result — the structured alternative to a plain value, used for tests where
// TestDefinition.isCulture is true. Growth status, then zero or more organisms found, each with
// its own antibiotic sensitivity panel (S/I/R).
router.get('/:orderId/:code/culture-result', requireCapability('process'), async (req, res) => {
  const { orderId, code } = req.params;
  const t = await prisma.orderTest.findFirst({ where: { orderId, code } });
  if (!t || t.performingFacilityId !== req.user.facilityId) return res.status(404).json({ error: 'Not found' });
  const result = await prisma.cultureResult.findUnique({
    where: { orderTestId: t.id },
    include: { organisms: { include: { organism: true, sensitivities: { include: { antibiotic: true } } } } },
  });
  res.json(result);
});

router.post('/:orderId/:code/culture-result', requireCapability('process'), async (req, res) => {
  const { orderId, code } = req.params;
  const { growthStatus, organisms } = req.body || {};
  if (!['no_growth', 'growth', 'contaminated'].includes(growthStatus)) {
    return res.status(400).json({ error: 'growthStatus must be no_growth, growth, or contaminated' });
  }
  if (growthStatus === 'growth' && (!Array.isArray(organisms) || !organisms.length)) {
    return res.status(400).json({ error: 'At least one organism is required when growthStatus is "growth"' });
  }

  const t = await prisma.orderTest.findFirst({ where: { orderId, code } });
  if (!t || t.performingFacilityId !== req.user.facilityId) return res.status(404).json({ error: 'Not found' });
  if (t.status !== 'received') return res.status(409).json({ error: `Test is not awaiting entry (status: ${t.status})` });

  const { cultureResult, updated, summary } = await inTransaction(async tx => {
    // Replace any previous attempt cleanly rather than trying to diff it.
    await tx.cultureResult.deleteMany({ where: { orderTestId: t.id } });

    const cultureResult = await tx.cultureResult.create({
      data: {
        id: uid('CULT'), orderTestId: t.id, growthStatus,
        organisms: {
          create: (organisms || []).map(o => ({
            id: uid('OF'), organismId: o.organismId, colonyCount: o.colonyCount || null,
            sensitivities: {
              create: (o.sensitivities || []).filter(s => ['S', 'I', 'R'].includes(s.result)).map(s => ({
                id: uid('AS'), antibioticId: s.antibioticId, result: s.result,
              })),
            },
          })),
        },
      },
      include: { organisms: { include: { organism: true, sensitivities: { include: { antibiotic: true } } } } },
    });

    const summary = growthStatus === 'no_growth' ? 'No growth'
      : growthStatus === 'contaminated' ? 'Contaminated specimen'
      : `Growth: ${cultureResult.organisms.map(o => o.organism.name).join(', ')}`;

    const entered = await tx.orderTest.updateMany({
      where: { id: t.id, status: 'received' },
      data: { value: summary, status: 'interfaced', enteredAt: new Date(), enteredBy: req.user.name },
    });
    if (!entered.count) throw new HttpError(409, CHANGED_MEANWHILE);
    return { cultureResult, summary, updated: await tx.orderTest.findUnique({ where: { id: t.id } }) };
  });
  await logAudit(req.user, { action: 'culture_result', entityType: 'OrderTest', entityId: t.id, details: `${code}: ${summary}` });
  res.json({ ...updated, cultureResult });
});

// Validate & certify — done only by the facility that actually performed the test.
router.post('/:orderId/:code/certify', requireCapability('certify'), async (req, res) => {
  const { orderId, code } = req.params;
  const validatedBy = req.user.name; // the certifying pathologist/lab manager — not client-supplied

  const t = await prisma.orderTest.findFirst({ where: { orderId, code } });
  if (!t || t.performingFacilityId !== req.user.facilityId) return res.status(404).json({ error: 'Not found' });
  if (t.status !== 'interfaced') return res.status(409).json({ error: `Test is not awaiting validation (status: ${t.status})` });

  // A critical (panic) value cannot be certified until a successful notification has been recorded
  // (POST .../critical-notification) — this is a real patient-safety requirement, not paperwork.
  const criticalFlag = await criticalFlagOf(t);
  if (criticalFlag && !t.criticalNotifiedAt) {
    return res.status(400).json({ error: 'This is a critical value — record who was notified before certifying.', requiresCriticalNotification: true, flag: criticalFlag, flagLabel: CRITICAL_FLAG_LABELS[criticalFlag] });
  }

  const certified = await prisma.orderTest.updateMany({
    where: { id: t.id, status: 'interfaced' },
    data: { status: 'completed', validatedBy, validatedAt: new Date() },
  });
  if (!certified.count) return res.status(409).json({ error: CHANGED_MEANWHILE });
  const updated = await prisma.orderTest.findUnique({ where: { id: t.id } });
  await logAudit(req.user, { action: 'certify', entityType: 'OrderTest', entityId: t.id, details: `${code}: ${t.value} — certified${criticalFlag ? ` (critical value, notified ${t.criticalNotifiedTo})` : ''}` });

  // Reflex suggestions — never auto-ordered. Just surfaced here for the certifying staff to act
  // on with one click if they agree; adding one still requires a real specimen draw afterward,
  // same as any other test.
  let reflexSuggestions = [];
  const numericValue = parseFloat(updated.value);
  if (!Number.isNaN(numericValue)) {
    const rules = await prisma.reflexRule.findMany({ where: { triggerTestCode: code, enabled: true } });
    const matched = rules.filter(r => {
      switch (r.condition) {
        case '>': return numericValue > r.thresholdValue;
        case '<': return numericValue < r.thresholdValue;
        case '>=': return numericValue >= r.thresholdValue;
        case '<=': return numericValue <= r.thresholdValue;
        case '==': return numericValue === r.thresholdValue;
        default: return false;
      }
    });
    if (matched.length) {
      const resultCodes = matched.map(r => r.resultTestCode);
      const [alreadyOnOrder, resultTests] = await Promise.all([
        prisma.orderTest.findMany({ where: { orderId, code: { in: resultCodes } } }),
        prisma.testDefinition.findMany({ where: { code: { in: resultCodes } } }),
      ]);
      reflexSuggestions = matched
        .filter(r => !alreadyOnOrder.some(t2 => t2.code === r.resultTestCode)) // don't suggest something already on the order
        .map(r => {
          const rt = resultTests.find(x => x.code === r.resultTestCode);
          return { ruleId: r.id, name: r.name, resultTestCode: r.resultTestCode, resultTestName: rt ? rt.name : r.resultTestCode, reason: `${code} ${r.condition} ${r.thresholdValue}` };
        });
    }
  }

  res.json({ ...updated, reflexSuggestions });
});

// ---------- Amending a certified result (ISO 15189:2022 7.4.1.8) ----------
// The result as first reported is never overwritten: it moves to a ResultAmendment row, with who
// changed it, when and why, and the report then says it was amended. One step, by someone who can
// certify at the performing lab. When the change alters what the result means, an attempt to tell
// the clinician must be recorded with it; if nobody could be reached the amendment still goes out
// (a known-wrong result is not left standing) and stays on the outstanding list until someone is.
// A corrected value that is critical and not yet notified goes back to awaiting validation, where
// the ordinary critical-value rule holds it.
function readNotification(body) {
  if (!body) return { notification: null };
  const personName = (body.personName || '').trim();
  if (!personName) return { error: 'personName is required — who was told?' };
  if (!['phone', 'in_person'].includes(body.method)) return { error: 'method must be phone or in_person' };
  if (!['reached', 'not_reached'].includes(body.outcome)) return { error: 'outcome must be reached or not_reached' };
  const personRole = (body.personRole || '').trim() || null;
  return { notification: {
    personName, personRole, method: body.method, outcome: body.outcome, readBack: !!body.readBack,
    who: personRole ? `${personName} (${personRole})` : personName,
  } };
}

router.post('/:orderId/:code/amend', requireCapability('certify'), async (req, res) => {
  const { orderId, code } = req.params;
  const body = req.body || {};
  const kind = body.action === 'withdraw' ? 'withdrawn' : body.action === 'correct' ? 'corrected' : null;
  if (!kind) return res.status(400).json({ error: 'action must be correct or withdraw' });
  const reason = (body.reason || '').trim();
  if (reason.length < 5) return res.status(400).json({ error: 'A reason for the amendment is required.' });
  const newValue = kind === 'corrected' ? String(body.value == null ? '' : body.value).trim() : null;
  if (kind === 'corrected' && !newValue) return res.status(400).json({ error: 'The corrected value is required.' });
  const { notification, error } = readNotification(body.notification);
  if (error) return res.status(400).json({ error });

  const t = await prisma.orderTest.findFirst({ where: { orderId, code } });
  if (!t || t.performingFacilityId !== req.user.facilityId) return res.status(404).json({ error: 'Not found' });
  if (t.status !== 'completed') return res.status(409).json({ error: `Only a validated result can be amended (status: ${t.status})` });
  if (kind === 'corrected' && newValue === String(t.value == null ? '' : t.value).trim()) {
    return res.status(400).json({ error: 'The corrected value is the same as the reported value.' });
  }

  const [tc, order, specimen, earlier, facility] = await Promise.all([
    prisma.testDefinition.findUnique({ where: { code }, include: { refRanges: true } }),
    prisma.order.findUnique({ where: { id: orderId }, include: { patient: true } }),
    t.specimenId ? prisma.specimen.findUnique({ where: { id: t.specimenId } }) : null,
    prisma.resultAmendment.findFirst({ where: { orderTestId: t.id }, orderBy: { amendedAt: 'desc' } }),
    prisma.facility.findUnique({ where: { id: req.user.facilityId }, select: { name: true } }),
  ]);
  if (tc && tc.isCulture) return res.status(400).json({ error: 'Culture and sensitivity reports cannot be amended here yet.' });
  if (kind === 'withdrawn' && earlier && earlier.kind === 'withdrawn') return res.status(409).json({ error: 'This result is already withdrawn.' });

  const patient = order && order.patient;
  const at = specimen ? specimen.collectedAt : null;
  const wasWithdrawn = !!earlier && earlier.kind === 'withdrawn';
  const previousFlag = wasWithdrawn ? 'N/A' : (CRITICAL_FLAG_LABELS[t.criticalFlag] ? t.criticalFlag : flagOf(tc, patient, t.value, at));
  const newFlag = kind === 'withdrawn' ? 'N/A' : flagOf(tc, patient, newValue, at);
  const notifyRequired = changesMeaning(kind, previousFlag, newFlag);
  if (notifyRequired && !notification) {
    return res.status(400).json({ error: 'This amendment changes what the result means — record who was told, or that nobody could be reached.', requiresNotification: true });
  }

  const now = new Date();
  const reached = !!notification && notification.outcome === 'reached';
  const newCritical = CRITICAL_FLAG_LABELS[newFlag] ? newFlag : null;
  const held = !!newCritical && !reached; // back to awaiting validation, under the critical-value rule
  const newUnit = kind === 'corrected' ? (tc ? tc.units : t.unit) : null;

  const { amendment, updated } = await inTransaction(async tx => {
    // First, and only if the result is still exactly what was checked above.
    const changed = await tx.orderTest.updateMany({
      where: { id: t.id, status: 'completed', value: t.value },
      data: {
        value: kind === 'withdrawn' ? WITHDRAWN_TEXT : newValue, unit: newUnit,
        enteredAt: now, enteredBy: req.user.name,
        status: held ? 'interfaced' : 'completed',
        validatedBy: held ? null : req.user.name, validatedAt: held ? null : now,
        criticalFlag: newCritical,
        criticalNotifiedTo: newCritical && reached ? notification.who : null,
        criticalNotifiedAt: newCritical && reached ? now : null,
      },
    });
    if (!changed.count) throw new HttpError(409, CHANGED_MEANWHILE);
    const amendment = await tx.resultAmendment.create({
      data: {
        id: uid('AMD'), orderTestId: t.id, facilityId: req.user.facilityId, facilityName: facility ? facility.name : 'Unknown',
        kind, reason,
        previousValue: t.value, previousUnit: t.unit, previousFlag,
        previousEnteredBy: t.enteredBy, previousEnteredAt: t.enteredAt, previousValidatedBy: t.validatedBy, previousValidatedAt: t.validatedAt,
        newValue, newUnit, newFlag,
        amendedBy: req.user.name, amendedAt: now, notifyRequired,
        ...(reached ? { notifiedTo: notification.who, notifiedMethod: notification.method, notifiedAt: now, notifiedBy: req.user.name } : {}),
      },
    });
    if (newCritical && notification) {
      await tx.criticalNotification.create({
        data: {
          id: uid('CRN'), orderTestId: t.id, facilityId: req.user.facilityId, facilityName: facility ? facility.name : 'Unknown',
          personName: notification.personName, personRole: notification.personRole, method: notification.method, outcome: notification.outcome,
          readBack: reached && notification.readBack, note: 'Amended result', recordedBy: req.user.name, createdAt: now,
        },
      });
    }
    return { amendment, updated: await tx.orderTest.findUnique({ where: { id: t.id } }) };
  });
  const told = !notification ? '' : reached ? ` — told ${notification.who}` : ` — could not reach ${notification.who}`;
  await logAudit(req.user, {
    action: kind === 'withdrawn' ? 'result_withdrawn' : 'result_amended', entityType: 'OrderTest', entityId: t.id,
    details: `${code}: ${t.value} ${t.unit || ''} -> ${kind === 'withdrawn' ? 'withdrawn' : `${newValue} ${newUnit || ''}`}. Reason: ${reason}${told}`.replace(/\s+/g, ' '),
  });
  res.status(201).json({ ...updated, amendment: describeAmendment(amendment), held });
});

// Amendments made by this lab, newest first — ?pending=1 for those where the clinician still has
// to be told.
router.get('/amendments', async (req, res) => {
  if (!(await canHandleCriticals(req.user.role))) return res.json([]);
  const rows = await prisma.resultAmendment.findMany({
    where: { facilityId: req.user.facilityId, ...(req.query.pending ? { notifyRequired: true, notifiedAt: null } : {}) },
    include: { orderTest: { include: { order: { include: { patient: true, ward: true } }, specimen: true } } },
    orderBy: { amendedAt: 'desc' },
    take: 200,
  });
  res.json(rows.map(a => ({
    ...describeAmendment(a),
    orderId: a.orderTest.orderId, code: a.orderTest.code, name: a.orderTest.name,
    memoNumber: a.orderTest.order.memoNumber, orderedBy: a.orderTest.order.orderedBy,
    specimenNumber: a.orderTest.specimen ? a.orderTest.specimen.specimenNumber : null,
    patientType: a.orderTest.order.patientType, wardName: a.orderTest.order.ward ? a.orderTest.order.ward.name : null,
    patient: a.orderTest.order.patient,
  })));
});

// Record an attempt to tell the clinician about an amendment made earlier.
router.post('/amendments/:id/notification', requireCapability('process'), async (req, res) => {
  const { notification, error } = readNotification(req.body || {});
  if (error) return res.status(400).json({ error });
  const a = await prisma.resultAmendment.findUnique({ where: { id: req.params.id }, include: { orderTest: true } });
  if (!a || a.facilityId !== req.user.facilityId) return res.status(404).json({ error: 'Not found' });
  if (a.notifiedAt) return res.status(409).json({ error: `Already notified: ${a.notifiedTo}` });
  const reached = notification.outcome === 'reached';
  const updated = reached
    ? await prisma.resultAmendment.update({ where: { id: a.id }, data: { notifiedTo: notification.who, notifiedMethod: notification.method, notifiedAt: new Date(), notifiedBy: req.user.name } })
    : a;
  await logAudit(req.user, {
    action: reached ? 'amendment_notified' : 'amendment_attempt_failed', entityType: 'OrderTest', entityId: a.orderTestId,
    details: `${a.orderTest.code}: amended result — ${reached ? 'told' : 'could not reach'} ${notification.who}`,
  });
  res.status(201).json(describeAmendment(updated));
});

// Adds a reflex-suggested test to an already-existing order, as a fresh 'ordered' test — it still
// needs a real specimen collected for it afterward, same as any other test on the order.
router.post('/:orderId/add-reflex-test', requireCapability('collect'), async (req, res) => {
  const { orderId } = req.params;
  const { code } = req.body || {};
  if (!code) return res.status(400).json({ error: 'code is required' });

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) return res.status(404).json({ error: 'Not found' });
  if (order.orderingFacilityId !== req.user.facilityId) return res.status(403).json({ error: "Not this facility's order" });

  const existing = await prisma.orderTest.findFirst({ where: { orderId, code } });
  if (existing) return res.status(409).json({ error: 'This test is already on the order' });

  const tc = await prisma.testDefinition.findUnique({ where: { code } });
  if (!tc) return res.status(404).json({ error: 'Unknown test code' });

  const newTest = await prisma.orderTest.create({
    data: { id: uid('OT'), orderId, code, name: tc.name, performingFacilityId: req.user.facilityId, status: 'ordered' },
  });
  await logAudit(req.user, { action: 'reflex_test_added', entityType: 'OrderTest', entityId: newTest.id, details: `Added ${code} (${tc.name}) via reflex rule to order ${order.memoNumber}` });
  res.status(201).json(newTest);
});

module.exports = router;
