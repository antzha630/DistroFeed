'use strict';

const { getDb } = require('./db');
const worker = require('./worker');

function healthHandler(req, res) {
  const uptime = process.uptime();
  res.json({
    ok: true,
    uptime: Math.round(uptime),
    lastRunAt: worker.getLastRunAt(),
  });
}

function statusHandler(req, res) {
  const db = getDb();
  const lastRun = worker.getLastRunSummary();

  const runStats = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM published_items WHERE sent_at IS NOT NULL) AS totalPublished,
      (SELECT COUNT(*) FROM published_items WHERE error IS NOT NULL AND sent_at IS NULL) AS totalFailed
  `).get();

  const lastPublished = db.prepare(`
    SELECT feed_item_id, title, link, sent_at
    FROM published_items
    WHERE sent_at IS NOT NULL
    ORDER BY sent_at DESC
    LIMIT 10
  `).all();

  res.json({
    lastRun,
    totalPublished: runStats?.totalPublished ?? 0,
    totalFailed: runStats?.totalFailed ?? 0,
    lastPublished: lastPublished.map((r) => ({
      feedItemId: r.feed_item_id,
      title: r.title,
      link: r.link,
      sentAt: r.sent_at,
    })),
  });
}

function runNowHandler(req, res) {
  if (worker.getRunLock()) {
    res.status(409).json({
      ok: false,
      message: 'Poll already in progress. Try again later.',
    });
    return;
  }

  worker.runPoll().then((summary) => {
    res.json({ ok: true, summary });
  }).catch((err) => {
    res.status(500).json({
      ok: false,
      message: err.message || 'Poll failed',
    });
  });
}

module.exports = {
  healthHandler,
  statusHandler,
  runNowHandler,
};
