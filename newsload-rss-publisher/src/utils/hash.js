'use strict';

const crypto = require('crypto');

function sha256(str) {
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}

module.exports = { sha256 };
