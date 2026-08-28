const router = require('express').Router();
const prisma = require('../db');
const { requireAuth, requireCapability } = require('../middleware/auth');
const { uid } = require('../utils/id');

router.use(requireAuth);

router.get('/', requireCapability('manage_catalog'), async (req, res) => {
  const aliases = await prisma.testAlias.findMany({ orderBy: { hisCode: 'asc' } });
  res.json(aliases);
});

router.post('/', requireCapability('manage_catalog'), async (req, res) => {
  const { hisCode, internalCode } = req.body || {};
  if (!hisCode || !internalCode) return res.status(400).json({ error: 'hisCode and internalCode are required' });

  const test = await prisma.testDefinition.findUnique({ where: { code: internalCode } });
  if (!test) return res.status(404).json({ error: `No test in the catalog with code "${internalCode}"` });

  const exists = await prisma.testAlias.findUnique({ where: { hisCode } });
  if (exists) return res.status(409).json({ error: `"${hisCode}" is already mapped to "${exists.internalCode}"` });

  const alias = await prisma.testAlias.create({ data: { id: uid('ALIAS'), hisCode, internalCode } });
  res.status(201).json(alias);
});

router.delete('/:id', requireCapability('manage_catalog'), async (req, res) => {
  await prisma.testAlias.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

module.exports = router;
