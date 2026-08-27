const router = require('express').Router();
const prisma = require('../db');
const { requireAuth, requireRegional } = require('../middleware/auth');

router.use(requireAuth);

router.get('/', async (req, res) => {
  const tests = await prisma.testDefinition.findMany({
    include: { refRanges: true },
    orderBy: { code: 'asc' },
  });
  res.json(tests);
});

router.post('/', requireRegional, async (req, res) => {
  const { code, name, category, specimenType, method, units, tat, minTier, criticalLow, criticalHigh, comment, refRanges } = req.body || {};
  if (!code || !name) return res.status(400).json({ error: 'code and name are required' });
  const exists = await prisma.testDefinition.findUnique({ where: { code: code.toUpperCase() } });
  if (exists) return res.status(409).json({ error: `Test code ${code} already exists` });

  const created = await prisma.testDefinition.create({
    data: {
      code: code.toUpperCase(),
      name,
      category: category || 'General',
      specimenType, method, units,
      tat: tat || 24,
      minTier: minTier || 'health_centre',
      criticalLow: criticalLow ?? null,
      criticalHigh: criticalHigh ?? null,
      comment: comment || '',
      refRanges: { create: (refRanges || []).map(r => ({ sex: r.sex, ageMin: r.ageMin, ageMax: r.ageMax, low: r.low, high: r.high })) },
    },
    include: { refRanges: true },
  });
  res.status(201).json(created);
});

router.put('/:code', requireRegional, async (req, res) => {
  const { code } = req.params;
  const { name, category, specimenType, method, units, tat, minTier, criticalLow, criticalHigh, comment, refRanges } = req.body || {};
  const exists = await prisma.testDefinition.findUnique({ where: { code } });
  if (!exists) return res.status(404).json({ error: 'Not found' });

  await prisma.referenceRange.deleteMany({ where: { testCode: code } });
  const updated = await prisma.testDefinition.update({
    where: { code },
    data: {
      name, category, specimenType, method, units, tat, minTier,
      criticalLow: criticalLow ?? null,
      criticalHigh: criticalHigh ?? null,
      comment,
      refRanges: { create: (refRanges || []).map(r => ({ sex: r.sex, ageMin: r.ageMin, ageMax: r.ageMax, low: r.low, high: r.high })) },
    },
    include: { refRanges: true },
  });
  res.json(updated);
});

router.delete('/:code', requireRegional, async (req, res) => {
  const { code } = req.params;
  const exists = await prisma.testDefinition.findUnique({ where: { code } });
  if (!exists) return res.status(404).json({ error: 'Not found' });
  await prisma.referenceRange.deleteMany({ where: { testCode: code } });
  await prisma.testDefinition.delete({ where: { code } });
  res.json({ ok: true });
});

module.exports = router;
