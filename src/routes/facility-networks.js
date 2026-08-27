const router = require('express').Router();
const prisma = require('../db');
const { requireAuth, requireCapability } = require('../middleware/auth');
const { uid } = require('../utils/id');

router.use(requireAuth);
router.use(requireCapability('manage_labs'));

router.get('/', async (req, res) => {
  const networks = await prisma.facilityNetwork.findMany({
    include: { facility: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json(networks.map(n => ({ id: n.id, facilityId: n.facilityId, facilityName: n.facility.name, label: n.label, cidr: n.cidr })));
});

router.post('/', async (req, res) => {
  const { facilityId, label, cidr } = req.body || {};
  if (!facilityId || !label || !cidr) return res.status(400).json({ error: 'facilityId, label, and cidr are required' });
  const [range] = cidr.split('/');
  if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(range)) {
    return res.status(400).json({ error: 'cidr must look like an IPv4 address or range, e.g. 203.0.113.42 or 203.0.113.0/24' });
  }
  const network = await prisma.facilityNetwork.create({ data: { id: uid('NET'), facilityId, label, cidr } });
  res.status(201).json(network);
});

router.delete('/:id', async (req, res) => {
  await prisma.facilityNetwork.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

module.exports = router;
