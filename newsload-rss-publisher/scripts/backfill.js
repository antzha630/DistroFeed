#!/usr/bin/env node
'use strict';

require('dotenv').config();

const config = require('../src/config');
const logger = require('../src/logger');
const { getDb } = require('../src/db');
const { fetchFeed } = require('../src/rssClient');
const { publishNewItems } = require('../src/publisher');

async function backfill() {
  logger.info('Backfill started', {
    feedUrl: config.rssFeedUrl,
    limit: config.backfillLimit,
    dryRun: config.dryRun,
  });

  getDb();

  const { items, error } = await fetchFeed(config.rssFeedUrl, config.backfillLimit);
  if (error) {
    logger.error('Backfill aborted: RSS fetch failed', { message: error.message });
    process.exit(1);
  }

  logger.info('Fetched items for backfill', { count: items.length });

  const { sent, failed } = await publishNewItems(items, config.dryRun);

  logger.info('Backfill complete', { sent, failed, total: items.length });
  process.exit(0);
}

backfill().catch((err) => {
  logger.error('Backfill crashed', { message: err.message });
  process.exit(1);
});
