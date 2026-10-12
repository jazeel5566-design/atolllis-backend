const router = require('express').Router();
const prisma = require('../db');
const { requireAuth, requireCapability } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');
const { uid } = require('../utils/id');
const { newKey, retryMessage } = require('../utils/interface');

router.use(requireAuth);

const PROTOCOLS = ['astm', 'hl7'];
const CONNECTIONS = ['tcp', 'serial'];

// Lab managers manage their own facility's instruments. Admins may target another facility via
// ?facilityId= — same pattern as wards and user management.
function targetFacilityId(req) {
  const requested = req.query.facilityId || (req.body || {}).facilityId;
  if (requested && req.user.role === 'admin') return requested;
  return req.user.facilityId;
}

// The key itself is never returned after creation — only its prefix.
const describe = i => ({
  id: i.id, facilityId: i.facilityId, name: i.name, manufacturer: i.manufacturer, model: i.model,
  protocol: i.protocol, connection: i.connection, keyPrefix: i.keyPrefix, enabled: i.enabled,
  lastSeenAt: i.lastSeenAt, createdAt: i.createdAt, mappedTests: i.testMaps ? i.testMaps.length : undefined,
});

async function ownInstrument(req, res) {
  const instrument = await prisma.instrument.findUnique({ where: { id: req.params.id } });
  if (!instrument) { res.status(404).json({ error: 'Not found' }); return null; }
  if (req.user.role !== 'admin' && instrument.facilityId !== req.user.facilityId) {
    res.status(403).json({ error: "Not this facility's instrument" }); return null;
  }
  return instrument;
}

// ---------- Interface log (what the analysers asked and sent) ----------
// ?view=held (default: results waiting for a person) | all, ?instrumentId=, ?limit=
router.get('/messages', requireCapability('process'), async (req, res) => {
  const where = { facilityId: req.user.facilityId };
  if (req.query.view !== 'all') where.status = 'unmatched';
  if (req.query.instrumentId) where.instrumentId = String(req.query.instrumentId);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 200, 1), 500);
  const [messages, held] = await Promise.all([
    prisma.interfaceMessage.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit }),
    prisma.interfaceMessage.count({ where: { facilityId: req.user.facilityId, status: 'unmatched' } }),
  ]);
  res.json({ held, messages });
});

async function heldMessage(req, res) {
  const message = await prisma.interfaceMessage.findUnique({ where: { id: req.params.id } });
  if (!message || message.facilityId !== req.user.facilityId) { res.status(404).json({ error: 'Not found' }); return null; }
  if (message.status !== 'unmatched') { res.status(409).json({ error: 'This entry is not waiting for a decision' }); return null; }
  return message;
}

router.post('/messages/:id/retry', requireCapability('process'), async (req, res) => {
  const message = await heldMessage(req, res);
  if (!message) return;
  if (message.kind !== 'result') return res.status(409).json({ error: 'Only a result can be retried' });
  res.json(await retryMessage(message, req.user));
});

router.post('/messages/:id/dismiss', requireCapability('process'), async (req, res) => {
  const note = String((req.body || {}).note || '').trim();
  if (!note) return res.status(400).json({ error: 'A note saying why is required' });
  const message = await heldMessage(req, res);
  if (!message) return;
  const updated = await prisma.interfaceMessage.update({
    where: { id: message.id },
    data: { status: 'dismissed', resolvedBy: req.user.name, resolvedAt: new Date(), resolveNote: note },
  });
  await logAudit(req.user, { action: 'interface_dismiss', entityType: 'InterfaceMessage', entityId: message.id, details: `Dismissed ${message.kind} from ${message.instrumentName}${message.specimenNumber ? ` for ${message.specimenNumber}` : ''}: ${note}` });
  res.json(updated);
});

// ---------- Instruments ----------
router.get('/', requireCapability('manage_users'), async (req, res) => {
  const instruments = await prisma.instrument.findMany({ where: { facilityId: targetFacilityId(req) }, include: { testMaps: true }, orderBy: { name: 'asc' } });
  res.json(instruments.map(describe));
});

function readFields(body) {
  const name = String(body.name || '').trim();
  if (!name) return { error: 'name is required' };
  if (!PROTOCOLS.includes(body.protocol)) return { error: `protocol must be one of: ${PROTOCOLS.join(', ')}` };
  if (!CONNECTIONS.includes(body.connection)) return { error: `connection must be one of: ${CONNECTIONS.join(', ')}` };
  if (body.protocol === 'hl7' && body.connection === 'serial') return { error: 'HL7 instruments connect over the network, not a serial cable' };
  return { data: { name, manufacturer: String(body.manufacturer || '').trim() || null, model: String(body.model || '').trim() || null, protocol: body.protocol, connection: body.connection } };
}

router.post('/', requireCapability('manage_users'), async (req, res) => {
  const { data, error } = readFields(req.body || {});
  if (error) return res.status(400).json({ error });
  const facilityId = targetFacilityId(req);
  if (await prisma.instrument.findUnique({ where: { facilityId_name: { facilityId, name: data.name } } })) {
    return res.status(409).json({ error: `An instrument named "${data.name}" already exists at this facility` });
  }
  const { key, keyHash, keyPrefix } = newKey();
  const instrument = await prisma.instrument.create({ data: { id: uid('INS'), facilityId, ...data, keyHash, keyPrefix } });
  await logAudit(req.user, { action: 'instrument_add', entityType: 'Instrument', entityId: instrument.id, details: `Added instrument ${data.name} (${data.protocol}, ${data.connection})` });
  res.status(201).json({ ...describe(instrument), key }); // the only time the key is shown
});

router.put('/:id', requireCapability('manage_users'), async (req, res) => {
  const instrument = await ownInstrument(req, res);
  if (!instrument) return;
  const body = req.body || {};
  const { data, error } = readFields({ ...instrument, ...body });
  if (error) return res.status(400).json({ error });
  if (data.name !== instrument.name && await prisma.instrument.findUnique({ where: { facilityId_name: { facilityId: instrument.facilityId, name: data.name } } })) {
    return res.status(409).json({ error: `An instrument named "${data.name}" already exists at this facility` });
  }
  if (typeof body.enabled === 'boolean') data.enabled = body.enabled;
  const updated = await prisma.instrument.update({ where: { id: instrument.id }, data });
  await logAudit(req.user, { action: 'instrument_update', entityType: 'Instrument', entityId: instrument.id, details: `Updated instrument ${updated.name}${typeof body.enabled === 'boolean' ? ` — ${updated.enabled ? 'switched on' : 'switched off'}` : ''}` });
  res.json(describe(updated));
});

// Replaces the key: the bridge stops working until it is given the new one.
router.post('/:id/regenerate-key', requireCapability('manage_users'), async (req, res) => {
  const instrument = await ownInstrument(req, res);
  if (!instrument) return;
  const { key, keyHash, keyPrefix } = newKey();
  const updated = await prisma.instrument.update({ where: { id: instrument.id }, data: { keyHash, keyPrefix } });
  await logAudit(req.user, { action: 'instrument_new_key', entityType: 'Instrument', entityId: instrument.id, details: `Issued a new key for instrument ${instrument.name}` });
  res.json({ ...describe(updated), key });
});

router.delete('/:id', requireCapability('manage_users'), async (req, res) => {
  const instrument = await ownInstrument(req, res);
  if (!instrument) return;
  await prisma.instrument.delete({ where: { id: instrument.id } });
  await logAudit(req.user, { action: 'instrument_delete', entityType: 'Instrument', entityId: instrument.id, details: `Removed instrument ${instrument.name}` });
  res.json({ ok: true });
});

// ---------- Test code mapping ----------
router.get('/:id/maps', requireCapability('manage_users'), async (req, res) => {
  const instrument = await ownInstrument(req, res);
  if (!instrument) return;
  res.json(await prisma.instrumentTestMap.findMany({ where: { instrumentId: instrument.id }, orderBy: { instrumentCode: 'asc' } }));
});

router.post('/:id/maps', requireCapability('manage_users'), async (req, res) => {
  const instrument = await ownInstrument(req, res);
  if (!instrument) return;
  const body = req.body || {};
  const instrumentCode = String(body.instrumentCode || '').trim(), testCode = String(body.testCode || '').trim();
  if (!instrumentCode || !testCode) return res.status(400).json({ error: 'instrumentCode and testCode are required' });
  const tc = await prisma.testDefinition.findUnique({ where: { code: testCode } });
  if (!tc) return res.status(400).json({ error: `Test ${testCode} is not in the catalog` });
  if (tc.isCulture) return res.status(400).json({ error: 'Culture tests are entered by hand and cannot be mapped to an analyser' });
  const clash = await prisma.instrumentTestMap.findFirst({ where: { instrumentId: instrument.id, OR: [{ instrumentCode }, { testCode }] } });
  if (clash) return res.status(409).json({ error: clash.instrumentCode === instrumentCode ? `Analyser code "${instrumentCode}" is already mapped on this instrument` : `Test ${testCode} is already mapped on this instrument` });
  const map = await prisma.instrumentTestMap.create({
    data: { id: uid('ITM'), instrumentId: instrument.id, instrumentCode, testCode, units: String(body.units || '').trim() || null, acceptBlankUnit: body.acceptBlankUnit === true },
  });
  await logAudit(req.user, { action: 'instrument_map_add', entityType: 'Instrument', entityId: instrument.id, details: `${instrument.name}: analyser code ${instrumentCode} → test ${testCode}${map.units ? ` (unit "${map.units}")` : ''}${map.acceptBlankUnit ? ' (blank unit accepted)' : ''}` });
  res.status(201).json(map);
});

router.delete('/:id/maps/:mapId', requireCapability('manage_users'), async (req, res) => {
  const instrument = await ownInstrument(req, res);
  if (!instrument) return;
  const map = await prisma.instrumentTestMap.findUnique({ where: { id: req.params.mapId } });
  if (!map || map.instrumentId !== instrument.id) return res.status(404).json({ error: 'Not found' });
  await prisma.instrumentTestMap.delete({ where: { id: map.id } });
  await logAudit(req.user, { action: 'instrument_map_delete', entityType: 'Instrument', entityId: instrument.id, details: `${instrument.name}: removed mapping ${map.instrumentCode} → ${map.testCode}` });
  res.json({ ok: true });
});

module.exports = router;
