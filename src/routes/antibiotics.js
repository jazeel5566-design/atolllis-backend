const router = require('express').Router();
const prisma = require('../db');
const { requireAuth, requireCapability } = require('../middleware/auth');
const { uid } = require('../utils/id');

router.use(requireAuth);

router.get('/', async (req, res) => {
  const antibiotics = await prisma.antibiotic.findMany({ orderBy: { name: 'asc' } });
  res.json(antibiotics);
});

router.post('/', requireCapability('manage_catalog'), async (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  const exists = await prisma.antibiotic.findUnique({ where: { name } });
  if (exists) return res.status(409).json({ error: `"${name}" already exists` });
  const antibiotic = await prisma.antibiotic.create({ data: { id: uid('ANTB'), name } });
  res.status(201).json(antibiotic);
});

router.delete('/:id', requireCapability('manage_catalog'), async (req, res) => {
  await prisma.antibiotic.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

module.exports = router;
