'use strict';

const config = require('./config');
const logger = require('./logger');
const { getDb } = require('./db');
const { fetchFeed } = require('./rssClient');
const { publishNewItems } = require('./publisher');

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
  if (isRunning) {
    logger.warn('Poll already in progress, skipping');
    return null;
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
  };

  try {
    const { items, error } = await fetchFeed(config.rssFeedUrl, config.maxItemsPerPoll);
    summary.itemsFetched = items.length;

    if (error) {
      logger.error('Poll aborted due to RSS fetch error', { message: error.message });
      lastRunAt = startedAt;
      lastRunSummary = { ...summary, error: error.message };
      return lastRunSummary;
    }

    const alreadyPublished = items.filter((it) => {
      const row = db.prepare('SELECT 1 FROM published_items WHERE feed_item_id = ?').get(it.feedItemId);
      return !!row;
    }).length;
    summary.itemsNew = items.length - alreadyPublished;

    const { sent, failed } = await publishNewItems(items, config.dryRun);
    summary.itemsSent = sent;
    summary.itemsFailed = failed;

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
    lastRunSummary = { ...summary };
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
    lastRunSummary = { ...summary, error: err.message };
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
  getRunLock,
  getLastRunAt,
  getLastRunSummary,
  startScheduler,
};
