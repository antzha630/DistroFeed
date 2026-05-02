'use strict';

const { getDb } = require('./db');
const worker = require('./worker');

function homeHandler(req, res) {
  const uptime = Math.round(process.uptime());
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const status = worker.getLastRunSummary();

  res.type('html').send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Newsload RSS Publisher</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 2rem; color: #111; }
    code { background: #f4f4f4; padding: 0.125rem 0.25rem; border-radius: 4px; }
    .muted { color: #555; }
  </style>
</head>
<body>
  <h1>Newsload RSS Publisher</h1>
  <p>Service is running.</p>
  <p class="muted">Uptime: ${uptime}s</p>
  <p class="muted">Last run: ${status?.finishedAt || 'not run yet'}</p>
  <ul>
    <li><a href="${baseUrl}/health"><code>/health</code></a></li>
    <li><a href="${baseUrl}/status"><code>/status</code></a></li>
  </ul>
</body>
</html>`);
}

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
  homeHandler,
  healthHandler,
  statusHandler,
  runNowHandler,
};
