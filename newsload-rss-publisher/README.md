# newsload-rss-publisher

Automated RSS-to-Distro publisher for **Kite AI** that continuously polls Kite's Medium RSS feed and publishes each new post as an individual story to the Kite AI Distro newsload on staging.

This is a standalone background worker service (not part of ScoopStream runtime). Architecture is production-ready for future corporate clients.

## What It Does

- Runs continuously as a background worker
- Polls the RSS feed on a configurable interval (default: every 10 minutes)
- Detects only new posts (idempotent; no duplicate sends)
- Publishes each new post to the Distro staging endpoint
- Uses a newsload-specific API key (Kite AI key)
- Logs all actions and failures
- Supports one-time backfill mode for existing feed items

## Tech Stack

- Node.js (CommonJS)
- Express for minimal health/status endpoints
- `rss-parser` for feed parsing
- `axios` for Distro API POST
- `dotenv` for config
- SQLite for dedupe state and audit logs

## Setup

### Prerequisites

- Node.js 18+
- npm

### Install

```bash
cd newsload-rss-publisher
npm install
```

### Environment Variables

Copy `.env.example` to `.env` and fill in values:

```bash
cp .env.example .env
```

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | 4010 | HTTP server port |
| `NODE_ENV` | No | development | `development` or `production` |
| `DISTRO_API_ENDPOINT` | Yes | - | Distro staging API URL (e.g. `https://staging.example.com/api/stories`) |
| `DISTRO_API_KEY` | Yes | - | Kite AI newsload API key |
| `RSS_FEED_URL` | Yes | - | Kite AI Medium RSS feed URL |
| `POLL_INTERVAL_MINUTES` | No | 10 | Minutes between RSS polls |
| `MAX_ITEMS_PER_POLL` | No | 20 | Max feed items to process per poll |
| `REQUEST_TIMEOUT_MS` | No | 10000 | HTTP request timeout (ms) |
| `BACKFILL_LIMIT` | No | 100 | Max items to process in backfill |
| `DRY_RUN` | No | false | If `true`, log only; do not send to Distro |
| `LOG_LEVEL` | No | info | `info`, `debug`, `warn`, or `error` |
| `DATA_PATH` | No | `./data` | Directory for SQLite DB (set to `/data` on Render with persistent disk) |

## Local Run

### Start the service

```bash
npm start
```

The service will:

1. Initialize the SQLite database (in `data/newsload-rss.db`)
2. Run an immediate poll
3. Start the interval scheduler
4. Listen on `PORT` for HTTP requests

### Development (with file watching)

```bash
npm run dev
```

## Backfill

To publish historical items from the feed (e.g. before the first poll):

```bash
npm run backfill
```

- Respects dedupe: items already in `published_items` are skipped
- Limited by `BACKFILL_LIMIT` (default 100)
- Use `DRY_RUN=true` to simulate without sending:

```bash
DRY_RUN=true npm run backfill
```

## HTTP Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Returns `{ ok, uptime, lastRunAt }` |
| GET | `/status` | Latest run summary, totals, last 10 published items |
| POST | `/run-now` | Triggers an immediate poll (409 if poll already in progress) |

## Render Deployment

1. Create a new **Web Service** on Render
2. Connect your repository and set the root to `newsload-rss-publisher` (or the folder containing this project)
3. **Build command**: `npm install`
4. **Start command**: `npm start`
5. Set all required environment variables in the Render dashboard
6. **Persistent disk** (optional): Mount a disk at `/data` if you want SQLite data to survive deploys. Update `db.js` to use `process.env.DATA_PATH || path.join(process.cwd(), 'data')` and set `DATA_PATH=/data` on Render.

   **Alternative**: For production durability, consider migrating to Postgres instead of SQLite. Render provides managed Postgres.

## Verifying Posts in Kite AI Newsload

1. Run the service and wait for a poll (or trigger `/run-now`)
2. Check `/status` for `lastPublished` and `totalPublished`
3. In the Kite AI Distro/newsload UI, verify new stories appear with:
   - Title from the Medium post
   - Source: "Kite AI"
   - User: "Kite AI RSS Bot"
   - Link to the Medium article

## Troubleshooting

### Invalid API key

- **Symptom**: Distro returns 401/403, or `itemsFailed` increases
- **Fix**: Verify `DISTRO_API_KEY` is correct and has access to the Kite AI newsload
- **Check**: `curl -X POST $DISTRO_API_ENDPOINT -H "x-api-key: $DISTRO_API_KEY" -H "Content-Type: application/json" -d '{}'` and inspect response

### Bad RSS URL

- **Symptom**: "RSS fetch failed" in logs, `items` empty
- **Fix**: Ensure `RSS_FEED_URL` is a valid Medium feed (e.g. `https://medium.com/feed/@username` or `https://medium.com/feed/publication-name`)
- **Check**: Open the URL in a browser; it should return XML

### Duplicates

- **Symptom**: Same post sent multiple times
- **Fix**: The service uses `feed_item_id` (GUID or URL hash) for dedupe. If duplicates occur:
  - Ensure only one instance is running (no duplicate workers)
  - Check that `data/newsload-rss.db` is not reset between runs
  - On Render, add a persistent disk so SQLite state survives deploys

### Poll overlap

- **Symptom**: 409 on `/run-now` when a poll is already running
- **Fix**: This is expected. Wait for the current poll to finish (check `/status`) and retry

## Project Structure

```
newsload-rss-publisher/
  package.json
  README.md
  .env.example
  src/
    index.js       # Entry point, Express server, worker bootstrap
    config.js      # Env validation and config
    logger.js      # Structured logging
    db.js          # SQLite init and schema
    rssClient.js   # RSS fetch and normalization
    publisher.js   # Distro API publish logic
    worker.js      # Poll scheduler and run logic
    routes.js      # HTTP handlers
    utils/
      normalize.js # URL, HTML, stable ID helpers
      hash.js      # SHA256 for URL hashing
  scripts/
    backfill.js    # One-time historical publish
  data/            # SQLite DB (created at runtime)
```

## License

Private / internal use for Kite AI.
