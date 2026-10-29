const router = require('express').Router();
const prisma = require('../db');
const { requireAuth, requireCapability } = require('../middleware/auth');
const { cleanDhivehi } = require('../utils/dhivehi');
const { logAudit } = require('../utils/audit');

router.use(requireAuth);

router.get('/', async (req, res) => {
  const facilities = await prisma.facility.findMany({ orderBy: { name: 'asc' } });
  res.json(facilities);
});

// Only the Regional Hospital can create new Atoll Hospitals or Health Centres.
router.post('/', requireCapability('manage_labs'), async (req, res) => {
  const { name, tier, parentAtollId } = req.body || {};
  if (!name || !['atoll', 'health_centre'].includes(tier)) {
    return res.status(400).json({ error: 'name and tier ("atoll" or "health_centre") are required' });
  }
  const facility = await prisma.facility.create({
    data: {
      name,
      tier,
      // A Health Centre with no Atoll Hospital assigned refers straight to Regional by default.
      parentAtollId: tier === 'health_centre' ? (parentAtollId || null) : null,
    },
  });
  res.status(201).json(facility);
});

// The Dhivehi lines printed on this lab's reports: its name, the report title, and a note at the
// foot of each sheet. Any of them may be left empty, and is then left off the print.
router.put('/:id/dhivehi', requireCapability('manage_labs'), async (req, res) => {
  const body = req.body || {};
  const data = {
    nameDhivehi: cleanDhivehi(body.nameDhivehi, 'The Dhivehi name', 120),
    reportTitleDhivehi: cleanDhivehi(body.reportTitleDhivehi, 'The Dhivehi report title', 120),
    reportNoteDhivehi: cleanDhivehi(body.reportNoteDhivehi, 'The Dhivehi note', 400),
  };
  const facility = await prisma.facility.findUnique({ where: { id: req.params.id } });
  if (!facility) return res.status(404).json({ error: 'Not found' });
  const updated = await prisma.facility.update({ where: { id: facility.id }, data });
  await logAudit(req.user, { action: 'facility_dhivehi', entityType: 'Facility', entityId: facility.id, details: `Updated the Dhivehi report text of ${facility.name}` });
  res.json(updated);
});

// Removing an Atoll Hospital re-parents its Health Centres to Regional rather than blocking.
router.delete('/:id', requireCapability('manage_labs'), async (req, res) => {
  const { id } = req.params;
  const facility = await prisma.facility.findUnique({ where: { id } });
  if (!facility) return res.status(404).json({ error: 'Not found' });
  if (facility.tier === 'regional') return res.status(400).json({ error: 'Cannot remove the Regional Hospital' });

  const orderCount = await prisma.order.count({ where: { orderingFacilityId: id } });
  if (orderCount > 0) return res.status(409).json({ error: 'Cannot remove a lab that already has orders on record' });

  const children = await prisma.facility.findMany({ where: { parentAtollId: id } });
  if (children.length) {
    await prisma.facility.updateMany({ where: { parentAtollId: id }, data: { parentAtollId: null } });
  }
  await prisma.facility.delete({ where: { id } });
  res.json({ ok: true, reparentedHealthCentres: children.length });
});

module.exports = router;
