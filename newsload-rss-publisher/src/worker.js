'use strict';

const config = require('./config');
const logger = require('./logger');
const { getDb } = require('./db');
const { fetchFeed } = require('./rssClient');
const { publishNewItemsWithOptions } = require('./publisher');

let isRunning = false;
let lastRunAt = null;
let lastRunSummary = null;

function getRunLock() {
  return isRunning;
}

function setRunLock(value) {
  isRunning = value;
}

async function runPoll() {
  return runPopulate({
    rssFeedUrl: config.rssFeedUrl,
    apiEndpoint: config.distro.apiEndpoint,
    apiKey: config.distro.apiKey,
    maxItems: config.maxItemsPerPoll,
    dryRun: config.dryRun,
  });
}

async function runPopulate(options = {}) {
  if (isRunning) {
    logger.warn('Populate already in progress, skipping');
    return null;
  }

  const rssFeedUrl = (options.rssFeedUrl || config.rssFeedUrl || '').trim();
  const apiEndpoint = (options.apiEndpoint || config.distro.apiEndpoint || '').trim();
  const apiKey = (options.apiKey || config.distro.apiKey || '').trim();
  const maxItems = options.maxItems || config.maxItemsPerPoll;
  const dryRun = options.dryRun === true;

  if (!rssFeedUrl) {
    return { itemsFetched: 0, itemsNew: 0, itemsSent: 0, itemsFailed: 0, itemsSkipped: 0, error: 'RSS feed URL is required' };
  }
  if (!apiEndpoint) {
    return { itemsFetched: 0, itemsNew: 0, itemsSent: 0, itemsFailed: 0, itemsSkipped: 0, error: 'Distro API endpoint is required' };
  }
  if (!apiKey && !dryRun) {
    return { itemsFetched: 0, itemsNew: 0, itemsSent: 0, itemsFailed: 0, itemsSkipped: 0, error: 'API key is required unless dry run is enabled' };
  }

  setRunLock(true);
  const startedAt = new Date().toISOString();
  const db = getDb();

  const runId = db.prepare(
    'INSERT INTO worker_runs (started_at, finished_at, items_fetched, items_new, items_sent, items_failed) VALUES (?, NULL, 0, 0, 0, 0)'
  ).run(startedAt).lastInsertRowid;

  let summary = {
    itemsFetched: 0,
    itemsNew: 0,
    itemsSent: 0,
    itemsFailed: 0,
    itemsSkipped: 0,
    startedAt,
    finishedAt: null,
    mode: 'populate',
    dryRun,
    itemResults: [],
  };

  try {
    const { items, error } = await fetchFeed(rssFeedUrl, maxItems);
    summary.itemsFetched = items.length;

    if (error) {
      logger.error('Poll aborted due to RSS fetch error', { message: error.message });
      lastRunAt = startedAt;
      lastRunSummary = { ...summary, error: error.message, finishedAt: new Date().toISOString() };
      return lastRunSummary;
    }

    const alreadyPublished = items.filter((it) => {
      const row = db.prepare('SELECT 1 FROM published_items WHERE feed_item_id = ?').get(it.feedItemId);
      return !!row;
    }).length;
    summary.itemsNew = items.length - alreadyPublished;

    const { sent, failed, skipped, itemResults } = await publishNewItemsWithOptions(items, dryRun, {
      apiEndpoint,
      apiKey,
    });
    summary.itemsSent = sent;
    summary.itemsFailed = failed;
    summary.itemsSkipped = skipped;
    summary.itemResults = itemResults;

    const finishedAt = new Date().toISOString();
    db.prepare(
      'UPDATE worker_runs SET finished_at = ?, items_fetched = ?, items_new = ?, items_sent = ?, items_failed = ? WHERE id = ?'
    ).run(
      finishedAt,
      summary.itemsFetched,
      summary.itemsNew,
      summary.itemsSent,
      summary.itemsFailed,
      runId
    );

    lastRunAt = finishedAt;
    lastRunSummary = { ...summary, finishedAt };
    logger.info('Poll complete', summary);

    return lastRunSummary;
  } catch (err) {
    logger.error('Poll crashed', { message: err.message });
    const finishedAt = new Date().toISOString();
    db.prepare(
      'UPDATE worker_runs SET finished_at = ?, items_fetched = ?, items_new = ?, items_sent = ?, items_failed = ? WHERE id = ?'
    ).run(
      finishedAt,
      summary.itemsFetched,
      summary.itemsNew,
      summary.itemsSent,
      summary.itemsFailed,
      runId
    );
    lastRunAt = finishedAt;
    lastRunSummary = { ...summary, finishedAt, error: err.message };
    return lastRunSummary;
  } finally {
    setRunLock(false);
  }
}

function getLastRunAt() {
  return lastRunAt;
}

function getLastRunSummary() {
  return lastRunSummary;
}

function startScheduler() {
  const intervalMs = config.pollIntervalMinutes * 60 * 1000;
  logger.info('Scheduler started', { intervalMinutes: config.pollIntervalMinutes });

  setInterval(() => {
    runPoll().catch((err) => {
      logger.error('Scheduled poll error', { message: err.message });
    });
  }, intervalMs);
}

module.exports = {
  runPoll,
  runPopulate,
  getRunLock,
  getLastRunAt,
  getLastRunSummary,
  startScheduler,
};
