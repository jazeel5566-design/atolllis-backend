const { randomBytes } = require('crypto');

function uid(prefix) {
  return prefix + Date.now().toString(36).toUpperCase() + randomBytes(2).toString('hex').toUpperCase();
}

module.exports = { uid };
