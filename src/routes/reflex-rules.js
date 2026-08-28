const router = require('express').Router();
const prisma = require('../db');
const { requireAuth, requireCapability } = require('../middleware/auth');
const { uid } = require('../utils/id');

const VALID_CONDITIONS = ['>', '<', '>=', '<=', '=='];

router.use(requireAuth);

// Any authenticated user can read the list — needed so the certify screen can check for matches.
router.get('/', async (req, res) => {
  const rules = await prisma.reflexRule.findMany({ orderBy: { name: 'asc' } });
  res.json(rules);
});

router.post('/', requireCapability('manage_catalog'), async (req, res) => {
  const { name, triggerTestCode, condition, thresholdValue, resultTestCode } = req.body || {};
  if (!name || !triggerTestCode || !condition || thresholdValue === undefined || !resultTestCode) {
    return res.status(400).json({ error: 'name, triggerTestCode, condition, thresholdValue, and resultTestCode are all required' });
  }
  if (!VALID_CONDITIONS.includes(condition)) return res.status(400).json({ error: `condition must be one of: ${VALID_CONDITIONS.join(', ')}` });

  const [trigger, result] = await Promise.all([
    prisma.testDefinition.findUnique({ where: { code: triggerTestCode } }),
    prisma.testDefinition.findUnique({ where: { code: resultTestCode } }),
  ]);
  if (!trigger) return res.status(404).json({ error: `No test with code "${triggerTestCode}"` });
  if (!result) return res.status(404).json({ error: `No test with code "${resultTestCode}"` });

  const rule = await prisma.reflexRule.create({
    data: { id: uid('REFLEX'), name, triggerTestCode, condition, thresholdValue: Number(thresholdValue), resultTestCode, enabled: true },
  });
  res.status(201).json(rule);
});

// Enable/disable and full edits both go through here — enabling/disabling is just a normal field
// update, gated the same as creating or deleting a rule (manage_catalog).
router.put('/:id', requireCapability('manage_catalog'), async (req, res) => {
  const { name, triggerTestCode, condition, thresholdValue, resultTestCode, enabled } = req.body || {};
  const data = {};
  if (name !== undefined) data.name = name;
  if (triggerTestCode !== undefined) data.triggerTestCode = triggerTestCode;
  if (condition !== undefined) {
    if (!VALID_CONDITIONS.includes(condition)) return res.status(400).json({ error: `condition must be one of: ${VALID_CONDITIONS.join(', ')}` });
    data.condition = condition;
  }
  if (thresholdValue !== undefined) data.thresholdValue = Number(thresholdValue);
  if (resultTestCode !== undefined) data.resultTestCode = resultTestCode;
  if (enabled !== undefined) data.enabled = !!enabled;

  const rule = await prisma.reflexRule.update({ where: { id: req.params.id }, data });
  res.json(rule);
});

router.delete('/:id', requireCapability('manage_catalog'), async (req, res) => {
  await prisma.reflexRule.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

module.exports = router;
