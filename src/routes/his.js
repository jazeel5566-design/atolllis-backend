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

// Dev/demo utility only: seeds a new memo into the mock external system so the fetch flow can be
// exercised repeatedly without a real HIS/Billing integration. Remove this route in production —
// memo creation belongs entirely to the external system, never to this app.
router.post('/memos', requireAuth, async (req, res) => {
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
