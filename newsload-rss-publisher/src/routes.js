'use strict';

const config = require('./config');
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
  <title>Distro Populate</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 2rem; color: #111; max-width: 900px; line-height: 1.45; }
    code { background: #f4f4f4; padding: 0.125rem 0.25rem; border-radius: 4px; }
    .muted { color: #555; }
    .form-fields {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 1.35rem 2rem;
      align-items: start;
    }
    .full { grid-column: 1 / -1; }
    .field { display: flex; flex-direction: column; gap: 0.45rem; min-width: 0; }
    label { font-weight: 600; font-size: 0.875rem; letter-spacing: 0.01em; color: #333; }
    input, select { width: 100%; padding: 0.65rem 0.85rem; border-radius: 8px; border: 1px solid #cfcfcf; font-size: 14px; background: #fff; transition: border-color 0.15s; }
    input:focus, select:focus { outline: none; border-color: #111; box-shadow: 0 0 0 3px rgba(17,17,17,0.08); }
    button { padding: 0.75rem 1.25rem; border: 0; border-radius: 8px; background: #111; color: #fff; cursor: pointer; font-weight: 600; font-size: 15px; align-self: flex-start; margin-top: 0.25rem; }
    button:disabled { opacity: 0.7; cursor: wait; }
    .card { border: 1px solid #e8e8e8; border-radius: 12px; padding: 1.5rem 1.75rem; margin-top: 1.25rem; background: #fafafa; }
    @media (max-width: 640px) {
      body { margin: 1.25rem; }
      .form-fields { grid-template-columns: 1fr; gap: 1.35rem; }
    }
    .ok { color: #1a7f37; font-weight: 600; }
    .fail { color: #b42318; font-weight: 600; }
    .partial { color: #9a6700; font-weight: 600; }
    table { width: 100%; border-collapse: collapse; margin-top: 0.75rem; }
    th, td { border-bottom: 1px solid #eee; text-align: left; padding: 0.4rem; font-size: 13px; }
  </style>
</head>
<body>
  <h1>Distro Populate</h1>
  <p>Populate a newsload from an RSS feed up to the current moment.</p>
  <p class="muted">Uptime: ${uptime}s</p>
  <p class="muted">Last run: ${status?.finishedAt || 'not run yet'}</p>
  <form id="populateForm" class="card">
    <div class="form-fields">
    <div class="full field">
      <label for="rssFeedUrl">RSS Feed URL</label>
      <input id="rssFeedUrl" name="rssFeedUrl" required placeholder="https://medium.com/feed/@KiteAI" value="${config.rssFeedUrl || ''}" />
    </div>
    <div class="field">
      <label for="apiKey">API Key (optional if server default configured)</label>
      <input id="apiKey" name="apiKey" type="password" placeholder="sk_..." autocomplete="off" />
    </div>
    <div class="field">
      <label for="apiEndpoint">Distro API Endpoint</label>
      <input id="apiEndpoint" name="apiEndpoint" placeholder="https://.../api/external/news" value="${config.distro.apiEndpoint || ''}" autocomplete="off" />
    </div>
    <div class="field">
      <label for="maxItems">Max Items</label>
      <input id="maxItems" name="maxItems" type="number" min="1" value="20" />
    </div>
    <div class="field">
      <label for="dryRun">Mode</label>
      <select id="dryRun" name="dryRun">
        <option value="false" selected>Publish to Distro</option>
        <option value="true">Dry run (no publish)</option>
      </select>
    </div>
    <div class="full field">
      <button id="runBtn" type="submit">Run Populate</button>
    </div>
    </div>
  </form>
  <div id="result" class="card muted">No run triggered yet.</div>
  <ul>
    <li><a href="${baseUrl}/health"><code>/health</code></a></li>
    <li><a href="${baseUrl}/status"><code>/status</code></a></li>
  </ul>
  <script>
    const form = document.getElementById('populateForm');
    const runBtn = document.getElementById('runBtn');
    const result = document.getElementById('result');

    function statusClass(summary) {
      if (summary.error || summary.itemsFailed > 0) return summary.itemsSent > 0 ? 'partial' : 'fail';
      return 'ok';
    }

    function statusLabel(summary) {
      if (summary.error || summary.itemsFailed > 0) return summary.itemsSent > 0 ? 'PARTIAL' : 'FAILED';
      return 'SUCCESS';
    }

    function formatSourceDate(iso) {
      if (!iso) return '—';
      try {
        return new Date(iso).toISOString().slice(0, 10);
      } catch (e) { return iso; }
    }

    function renderRows(itemResults) {
      if (!Array.isArray(itemResults) || itemResults.length === 0) return '<p class="muted">No item-level results available.</p>';
      const rows = itemResults.slice(0, 15).map((item) =>
        '<tr>' +
          '<td>' + (item.title || '(untitled)') + '</td>' +
          '<td class="muted">' + formatSourceDate(item.sourcePublishedAt) + '</td>' +
          '<td>' + item.status + '</td>' +
          '<td>' + (item.httpStatus || '-') + '</td>' +
          '<td>' + (item.error || item.reason || '-') + '</td>' +
        '</tr>'
      ).join('');
      return '<table><thead><tr><th>Title</th><th>RSS date</th><th>Status</th><th>HTTP</th><th>Reason</th></tr></thead><tbody>' + rows + '</tbody></table>';
    }

    function feedNote(summary) {
      var cap = summary.maxItemsRequested;
      var inXml = summary.itemsInFeedXml;
      if (cap == null || inXml == null) return '';
      if (inXml < cap) {
        return '<p class="muted"><strong>Note:</strong> You asked for up to <strong>' + cap + '</strong> items, but this RSS feed only returned <strong>' + inXml + '</strong> entries in its snapshot (Medium and many sites cap recent posts). To import more history you need another source than a single RSS fetch.</p>';
      }
      return '';
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      runBtn.disabled = true;
      runBtn.textContent = 'Running...';
      result.textContent = 'Running populate...';

      const payload = {
        rssFeedUrl: document.getElementById('rssFeedUrl').value.trim(),
        apiKey: document.getElementById('apiKey').value.trim(),
        apiEndpoint: document.getElementById('apiEndpoint').value.trim(),
        maxItems: Number(document.getElementById('maxItems').value || 20),
        dryRun: document.getElementById('dryRun').value === 'true',
      };

      try {
        const res = await fetch('/populate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        const summary = data.summary || {};
        result.innerHTML =
          '<p class="' + statusClass(summary) + '">Run status: ' + statusLabel(summary) + '</p>' +
          '<p><strong>Fetched:</strong> ' + (summary.itemsFetched || 0) +
          ' | <strong>New:</strong> ' + (summary.itemsNew || 0) +
          ' | <strong>Sent:</strong> ' + (summary.itemsSent || 0) +
          ' | <strong>Failed:</strong> ' + (summary.itemsFailed || 0) +
          ' | <strong>Skipped:</strong> ' + (summary.itemsSkipped || 0) + '</p>' +
          (summary.maxItemsRequested != null ? '<p class="muted"><strong>Max requested:</strong> ' + summary.maxItemsRequested +
            (summary.itemsInFeedXml != null ? ' &nbsp;|&nbsp; <strong>Entries in RSS XML:</strong> ' + summary.itemsInFeedXml : '') + '</p>' : '') +
          feedNote(summary) +
          '<p class="muted"><strong>Distro display date:</strong> If stories still show “just now” in Distro but RSS dates look correct here, the ingest API at your endpoint must map a published/custom date field into the story model — FetchFeed is sending multiple date keys; ask the API owner which one is supported.</p>' +
          '<p><strong>Started:</strong> ' + (summary.startedAt || '-') +
          ' | <strong>Finished:</strong> ' + (summary.finishedAt || '-') + '</p>' +
          (summary.error ? '<p class="fail"><strong>Error:</strong> ' + summary.error + '</p>' : '') +
          renderRows(summary.itemResults);
      } catch (err) {
        result.innerHTML = '<p class="fail">Run status: FAILED</p><p>' + (err.message || 'Request failed') + '</p>';
      } finally {
        runBtn.disabled = false;
        runBtn.textContent = 'Run Populate';
      }
    });
  </script>
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
    const hasFailures = summary?.error || (summary?.itemsFailed ?? 0) > 0;
    res.status(hasFailures ? 207 : 200).json({ ok: !summary?.error, summary });
  }).catch((err) => {
    res.status(500).json({
      ok: false,
      message: err.message || 'Poll failed',
    });
  });
}

function populateHandler(req, res) {
  if (worker.getRunLock()) {
    res.status(409).json({
      ok: false,
      message: 'Populate run already in progress. Try again later.',
    });
    return;
  }

  const body = req.body || {};
  const rawMax = body.maxItems;
  let maxItems;
  if (rawMax === undefined || rawMax === null || rawMax === '') {
    maxItems = undefined;
  } else {
    const n = parseInt(rawMax, 10);
    maxItems = Number.isFinite(n) && n > 0 ? n : undefined;
  }
  const payload = {
    rssFeedUrl: body.rssFeedUrl,
    apiKey: body.apiKey,
    apiEndpoint: body.apiEndpoint,
    maxItems,
    dryRun: body.dryRun === true,
  };

  worker.runPopulate(payload).then((summary) => {
    const hasFailures = summary?.error || (summary?.itemsFailed ?? 0) > 0;
    res.status(hasFailures ? 207 : 200).json({ ok: !summary?.error, summary });
  }).catch((err) => {
    res.status(500).json({
      ok: false,
      message: err.message || 'Populate failed',
    });
  });
}

module.exports = {
  homeHandler,
  healthHandler,
  statusHandler,
  runNowHandler,
  populateHandler,
};
