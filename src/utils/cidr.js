// Minimal IPv4 CIDR matcher — no external package needed for this.
// Handles the "::ffff:1.2.3.4" IPv4-mapped-IPv6 form Node sometimes reports too.

function normalizeIp(ip) {
  if (!ip) return null;
  if (ip.startsWith('::ffff:')) return ip.slice(7);
  if (ip === '::1') return '127.0.0.1';
  return ip;
}

function ipToInt(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(p => Number.isNaN(p) || p < 0 || p > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function ipInCidr(ip, cidr) {
  const normalizedIp = normalizeIp(ip);
  if (!normalizedIp || !cidr) return false;

  const [range, bitsStr] = cidr.split('/');
  const bits = bitsStr === undefined ? 32 : parseInt(bitsStr, 10);
  if (Number.isNaN(bits) || bits < 0 || bits > 32) return false;

  const ipInt = ipToInt(normalizedIp);
  const rangeInt = ipToInt(range);
  if (ipInt === null || rangeInt === null) return false;

  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipInt & mask) === (rangeInt & mask);
}

module.exports = { normalizeIp, ipInCidr };
