'use strict';

require('dotenv').config();

const VALID_NODE_ENV = ['development', 'production'];
const VALID_LOG_LEVEL = ['info', 'debug', 'warn', 'error'];

function parseBool(val) {
  if (val === undefined || val === '') return false;
  return String(val).toLowerCase() === 'true' || val === '1';
}

function parsePositiveInt(val, defaultVal, name) {
  const n = parseInt(val, 10);
  if (isNaN(n) || n < 1) return defaultVal;
  return n;
}

function validate() {
  const errors = [];

  const nodeEnv = process.env.NODE_ENV || 'development';
  if (!VALID_NODE_ENV.includes(nodeEnv)) {
    errors.push(`NODE_ENV must be one of: ${VALID_NODE_ENV.join(', ')}`);
  }

  const logLevel = process.env.LOG_LEVEL || 'info';
  if (!VALID_LOG_LEVEL.includes(logLevel)) {
    errors.push(`LOG_LEVEL must be one of: ${VALID_LOG_LEVEL.join(', ')}`);
  }

  if (errors.length > 0) {
    throw new Error(`Config validation failed:\n  - ${errors.join('\n  - ')}`);
  }
}

const config = {
  port: parsePositiveInt(process.env.PORT, 4010, 'PORT'),
  nodeEnv: process.env.NODE_ENV || 'development',
  distro: {
    apiEndpoint: process.env.DISTRO_API_ENDPOINT?.trim() || '',
    apiKey: process.env.DISTRO_API_KEY?.trim() || '',
  },
  rssFeedUrl: process.env.RSS_FEED_URL?.trim() || '',
  pollIntervalMinutes: parsePositiveInt(process.env.POLL_INTERVAL_MINUTES, 10, 'POLL_INTERVAL_MINUTES'),
  maxItemsPerPoll: parsePositiveInt(process.env.MAX_ITEMS_PER_POLL, 20, 'MAX_ITEMS_PER_POLL'),
  requestTimeoutMs: parsePositiveInt(process.env.REQUEST_TIMEOUT_MS, 10000, 'REQUEST_TIMEOUT_MS'),
  backfillLimit: parsePositiveInt(process.env.BACKFILL_LIMIT, 100, 'BACKFILL_LIMIT'),
  dryRun: parseBool(process.env.DRY_RUN),
  logLevel: process.env.LOG_LEVEL || 'info',
};

validate();

module.exports = config;
