const router = require('express').Router();
const prisma = require('../db');
const { hashKey, handleQuery, handleResult } = require('../utils/interface');

// The analyser side of the bidirectional interface. Called by the bridge program in each lab, never
// by a browser: there is no user session here, only the instrument's key in X-Instrument-Key. An
// instrument acts for its own facility and nothing else.
router.use(async (req, res, next) => {
  const key = req.headers['x-instrument-key'];
  if (!key) return res.status(401).json({ error: 'Missing instrument key' });
  const instrument = await prisma.instrument.findUnique({ where: { keyHash: hashKey(key) } });
  if (!instrument) return res.status(401).json({ error: 'Unknown instrument key' });
  if (!instrument.enabled) return res.status(403).json({ error: 'This instrument is switched off in Settings' });
  req.instrument = instrument;
  await prisma.instrument.update({ where: { id: instrument.id }, data: { lastSeenAt: new Date() } });
  next();
});

// Lets the bridge confirm its key and connection, and keeps "last seen" current while idle.
router.post('/heartbeat', async (req, res) => {
  const { id, name, protocol, connection } = req.instrument;
  res.json({ ok: true, instrument: { id, name, protocol, connection } });
});

router.post('/query', async (req, res) => {
  const body = req.body || {};
  if (!body.specimenNumber) return res.status(400).json({ error: 'specimenNumber is required' });
  res.json(await handleQuery(req.instrument, body));
});

// { specimenNumber, qc?, results: [{ instrumentCode, value, unit, flags?, raw? }] }. Always 200 when
// the batch was read: each result carries its own outcome, and one that cannot be placed is held
// in the log for a person rather than bounced back to the instrument.
router.post('/results', async (req, res) => {
  const body = req.body || {};
  if (!Array.isArray(body.results) || !body.results.length) return res.status(400).json({ error: 'results is required' });
  const outcomes = [];
  for (const r of body.results) {
    outcomes.push(await handleResult(req.instrument, { ...r, specimenNumber: body.specimenNumber, qc: !!(body.qc || r.qc) }));
  }
  res.json({ specimenNumber: body.specimenNumber || null, results: outcomes });
});

module.exports = router;
