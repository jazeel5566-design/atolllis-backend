const router = require('express').Router();
const prisma = require('../db');
const { requireAuth, requireCapability } = require('../middleware/auth');
const { uid } = require('../utils/id');

router.use(requireAuth);

router.get('/', async (req, res) => {
  const organisms = await prisma.organism.findMany({ orderBy: { name: 'asc' } });
  res.json(organisms);
});

router.post('/', requireCapability('manage_catalog'), async (req, res) => {
  const { name, group } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  const exists = await prisma.organism.findUnique({ where: { name } });
  if (exists) return res.status(409).json({ error: `"${name}" already exists` });
  const organism = await prisma.organism.create({ data: { id: uid('ORG'), name, group: group || null } });
  res.status(201).json(organism);
});

router.delete('/:id', requireCapability('manage_catalog'), async (req, res) => {
  await prisma.organism.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

// The antibiotic panel typically tested against this organism — any authenticated user can read
// it (needed at result entry to pre-populate the sensitivity form); only manage_catalog can edit it.
router.get('/:id/panel', async (req, res) => {
  const rows = await prisma.organismAntibioticPanel.findMany({
    where: { organismId: req.params.id }, include: { antibiotic: true },
  });
  res.json(rows.map(r => ({ antibioticId: r.antibioticId, antibioticName: r.antibiotic.name })));
});

router.put('/:id/panel', requireCapability('manage_catalog'), async (req, res) => {
  const { antibioticIds } = req.body || {};
  if (!Array.isArray(antibioticIds)) return res.status(400).json({ error: 'antibioticIds must be an array' });
  const organismId = req.params.id;
  await prisma.organismAntibioticPanel.deleteMany({ where: { organismId } });
  if (antibioticIds.length) {
    await prisma.organismAntibioticPanel.createMany({
      data: antibioticIds.map(antibioticId => ({ id: uid('OAP'), organismId, antibioticId })),
    });
  }
  res.json({ ok: true });
});

module.exports = router;
