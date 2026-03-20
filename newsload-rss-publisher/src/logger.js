'use strict';

const config = require('./config');

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLevel = LEVELS[config.logLevel] ?? LEVELS.info;

function shouldLog(level) {
  return LEVELS[level] >= currentLevel;
}

function formatMessage(level, msg, meta = {}) {
  const timestamp = new Date().toISOString();
  const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
  return `[${timestamp}] [${level.toUpperCase()}] ${msg}${metaStr}`;
}

const logger = {
  debug(msg, meta) {
    if (shouldLog('debug')) console.log(formatMessage('debug', msg, meta));
  },
  info(msg, meta) {
    if (shouldLog('info')) console.log(formatMessage('info', msg, meta));
  },
  warn(msg, meta) {
    if (shouldLog('warn')) console.warn(formatMessage('warn', msg, meta));
  },
  error(msg, meta) {
    if (shouldLog('error')) console.error(formatMessage('error', msg, meta));
  },
};

module.exports = logger;
