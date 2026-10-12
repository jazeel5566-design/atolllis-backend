const prisma = require('../db');

const OTHER_REASON_ID = 'other';

// Turns a reject request body ({ reasonId, note }) into the fields stored on a SpecimenRejection.
// reasonId must be an entry in the RejectionReason list, or 'other' — and "Other" is only accepted
// with an explanation, so a rejection can never be saved with no usable reason at all.
// Returns { error } instead of throwing so the route can answer 400 with the message.
async function resolveRejectionReason(body) {
  const { reasonId } = body || {};
  const note = ((body && body.note) || '').trim();
  if (!reasonId) return { error: 'reasonId is required' };

  if (reasonId === OTHER_REASON_ID) {
    if (!note) return { error: 'An explanation is required when the reason is "Other"' };
    return { reasonId: null, reasonName: 'Other', note, text: `Other — ${note}` };
  }

  const reason = await prisma.rejectionReason.findUnique({ where: { id: reasonId } });
  if (!reason) return { error: 'Unknown rejection reason — pick one from the list' };
  return { reasonId: reason.id, reasonName: reason.name, note: note || null, text: note ? `${reason.name} — ${note}` : reason.name };
}

module.exports = { OTHER_REASON_ID, resolveRejectionReason };
