const router = require('express').Router();
const prisma = require('../db');
const { requireAuth } = require('../middleware/auth');

// This router stands in for the real Hospital Information System / Billing system's API.
// In a real deployment this file — and the MockHisMemo table behind it — would not exist here;
// /api/orders/import would instead make an authenticated HTTP call to that external system.

router.get('/memos/:memoNumber', async (req, res) => {
  const memo = await prisma.mockHisMemo.findUnique({ where: { memoNumber: req.params.memoNumber } });
  if (!memo) return res.status(404).json({ error: 'Memo not found' });
  res.json({ ...memo, testCodes: JSON.parse(memo.testCodes) });
});

// Sample Collection's single fetch field accepts a memo number, a Hospital No., or an ID No. — this
// is the endpoint behind that: an exact memo number match wins if there is one, otherwise it searches
// by patient identifiers and returns every matching memo for the caller to disambiguate.
router.get('/search', requireAuth, async (req, res) => {
  const q = (req.query.query || '').trim();
  if (!q) return res.json({ matches: [] });

  const exact = await prisma.mockHisMemo.findUnique({ where: { memoNumber: q } });
  if (exact) {
    return res.json({ matches: [{ ...exact, testCodes: JSON.parse(exact.testCodes) }] });
  }

  const byPatient = await prisma.mockHisMemo.findMany({
    where: {
      OR: [
        { patientHospitalNumber: { contains: q, mode: 'insensitive' } },
        { patientIdNumber: { contains: q, mode: 'insensitive' } },
      ],
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ matches: byPatient.map(m => ({ ...m, testCodes: JSON.parse(m.testCodes) })) });
});

// Dev/demo utility only: seeds a new memo into the mock external system so the fetch flow can be
// exercised repeatedly without a real HIS/Billing integration. Remove this route in production —
// memo creation belongs entirely to the external system, never to this app. Admin-only, since it
// writes directly into data every facility treats as if it came from the real HIS.
router.post('/memos', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only an Admin can create a test memo' });
  const { memoNumber, source, orderedBy, patient, tests } = req.body || {};
  if (!memoNumber || !patient || !tests || !tests.length) {
    return res.status(400).json({ error: 'memoNumber, patient, and a non-empty tests array are required' });
  }
  const exists = await prisma.mockHisMemo.findUnique({ where: { memoNumber } });
  if (exists) return res.status(409).json({ error: 'A memo with that number already exists' });

  const memo = await prisma.mockHisMemo.create({
    data: {
      memoNumber,
      source: source || 'HIS',
      orderedBy: orderedBy || 'Attending Clinician',
      patientName: patient.name,
      patientIdNumber: patient.idNumber || null,
      patientHospitalNumber: patient.hospitalNumber || null,
      patientDob: patient.dob,
      patientSex: patient.sex,
      patientAddress: patient.address || null,
      testCodes: JSON.stringify(tests),
    },
  });
  res.status(201).json({ ...memo, testCodes: tests });
});

module.exports = router;
