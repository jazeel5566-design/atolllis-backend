const router = require('express').Router();
const prisma = require('../db');
const { requireAuth, requireCapability } = require('../middleware/auth');
const { uid } = require('../utils/id');

router.use(requireAuth);

router.get('/', async (req, res) => {
  const categories = await prisma.testCategory.findMany({ orderBy: { name: 'asc' } });
  res.json(categories);
});

router.post('/', requireCapability('manage_catalog'), async (req, res) => {
  const { name, letter } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' });
  const finalLetter = (letter && letter.trim() ? letter.trim() : name.trim()).charAt(0).toUpperCase();

  const nameExists = await prisma.testCategory.findUnique({ where: { name: name.trim() } });
  if (nameExists) return res.status(409).json({ error: `Category "${name}" already exists` });
  const letterExists = await prisma.testCategory.findUnique({ where: { letter: finalLetter } });
  if (letterExists) return res.status(409).json({ error: `Barcode letter "${finalLetter}" is already used by "${letterExists.name}" — choose a different letter.` });

  const category = await prisma.testCategory.create({
    data: { id: uid('CAT'), name: name.trim(), letter: finalLetter },
  });
  res.status(201).json(category);
});

// Renaming cascades to every test currently filed under the old name, so nothing goes uncategorized.
router.put('/:id', requireCapability('manage_catalog'), async (req, res) => {
  const { id } = req.params;
  const { name, letter } = req.body || {};
  const existing = await prisma.testCategory.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const data = {};
  if (name && name.trim() && name.trim() !== existing.name) {
    const nameExists = await prisma.testCategory.findUnique({ where: { name: name.trim() } });
    if (nameExists) return res.status(409).json({ error: `Category "${name}" already exists` });
    data.name = name.trim();
  }
  if (letter && letter.trim()) {
    const finalLetter = letter.trim().charAt(0).toUpperCase();
    if (finalLetter !== existing.letter) {
      const letterExists = await prisma.testCategory.findUnique({ where: { letter: finalLetter } });
      if (letterExists) return res.status(409).json({ error: `Barcode letter "${finalLetter}" is already used by "${letterExists.name}"` });
      data.letter = finalLetter;
    }
  }

  const updated = await prisma.testCategory.update({ where: { id }, data });
  if (data.name) {
    await prisma.testDefinition.updateMany({ where: { category: existing.name }, data: { category: data.name } });
  }
  res.json(updated);
});

router.delete('/:id', requireCapability('manage_catalog'), async (req, res) => {
  const { id } = req.params;
  const category = await prisma.testCategory.findUnique({ where: { id } });
  if (!category) return res.status(404).json({ error: 'Not found' });
  const inUse = await prisma.testDefinition.count({ where: { category: category.name } });
  if (inUse > 0) return res.status(409).json({ error: `${inUse} test(s) are still filed under "${category.name}" — move them to another category first.` });
  await prisma.testCategory.delete({ where: { id } });
  res.json({ ok: true });
});

module.exports = router;
