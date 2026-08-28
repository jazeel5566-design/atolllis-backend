const router = require('express').Router();
const prisma = require('../db');
const { requireAuth, requireCapability } = require('../middleware/auth');
const { uid } = require('../utils/id');

router.use(requireAuth);

router.get('/', async (req, res) => {
  const panels = await prisma.testPanel.findMany({ orderBy: { name: 'asc' } });
  res.json(panels.map(p => ({ ...p, testCodes: JSON.parse(p.testCodes) })));
});

router.post('/', requireCapability('manage_catalog'), async (req, res) => {
  const { name, testCodes } = req.body || {};
  if (!name || !Array.isArray(testCodes) || !testCodes.length) {
    return res.status(400).json({ error: 'name and a non-empty testCodes array are required' });
  }
  const exists = await prisma.testPanel.findUnique({ where: { name } });
  if (exists) return res.status(409).json({ error: `A panel named "${name}" already exists` });

  const panel = await prisma.testPanel.create({ data: { id: uid('PANEL'), name, testCodes: JSON.stringify(testCodes) } });
  res.status(201).json({ ...panel, testCodes });
});

router.put('/:id', requireCapability('manage_catalog'), async (req, res) => {
  const { name, testCodes } = req.body || {};
  const data = {};
  if (name) data.name = name;
  if (Array.isArray(testCodes)) data.testCodes = JSON.stringify(testCodes);
  const panel = await prisma.testPanel.update({ where: { id: req.params.id }, data });
  res.json({ ...panel, testCodes: JSON.parse(panel.testCodes) });
});

router.delete('/:id', requireCapability('manage_catalog'), async (req, res) => {
  await prisma.testPanel.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

module.exports = router;
