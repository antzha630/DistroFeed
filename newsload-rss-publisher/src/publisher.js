'use strict';

const axios = require('axios');
const config = require('./config');
const logger = require('./logger');
const { getDb } = require('./db');

function buildPayload(item, options = {}) {
  const includePublicationDate = options.includePublicationDate !== false;
  const payload = {
    user_info: { name: 'Kite AI RSS Bot' },
    title: item.title,
    content: item.body,
    more_info_url: item.link,
    source: 'Kite AI',
  };

  // Distro should display source publication date instead of ingest time when available.
  if (includePublicationDate && item.publishedAt) {
    payload.published_date = item.publishedAt;
  }

  return payload;
}

function recordItem(db, item, result) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO published_items
    (feed_item_id, title, link, published_at, first_seen_at, sent_at, distro_status, distro_response, error)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  if (result.success) {
    stmt.run(
      item.feedItemId,
      item.title,
      item.link,
      item.publishedAt,
      now,
      now,
      result.status ?? 0,
      result.response ? JSON.stringify(result.response) : null,
      null
    );
  } else {
    stmt.run(
      item.feedItemId,
      item.title,
      item.link,
      item.publishedAt,
      now,
      null,
      null,
      null,
      result.error || 'Unknown error'
    );
  }
}

async function publishOne(item, dryRun = false) {
  if (dryRun) {
    logger.info('DRY_RUN: would publish', { feedItemId: item.feedItemId, title: item.title });
    return { success: true, status: 0, response: null, dryRun: true, skipRecord: true };
  }

  const payload = buildPayload(item, { includePublicationDate: true });
  const fallbackPayload = buildPayload(item, { includePublicationDate: false });

  try {
    let res = await axios.post(config.distro.apiEndpoint, payload, {
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.distro.apiKey,
      },
      timeout: config.requestTimeoutMs,
      validateStatus: () => true,
    });

    // Keep compatibility with older Distro schemas that may reject date fields.
    if (item.publishedAt && res.status >= 400 && res.status < 500) {
      logger.warn('Retrying publish without published_date', {
        feedItemId: item.feedItemId,
        status: res.status,
      });
      res = await axios.post(config.distro.apiEndpoint, fallbackPayload, {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': config.distro.apiKey,
        },
        timeout: config.requestTimeoutMs,
        validateStatus: () => true,
      });
    }

    if (res.status >= 200 && res.status < 300) {
      logger.info('Published to Distro', { feedItemId: item.feedItemId, status: res.status });
      return { success: true, status: res.status, response: res.data };
    }

    logger.warn('Distro rejected', {
      feedItemId: item.feedItemId,
      status: res.status,
      data: res.data,
    });
    return {
      success: false,
      status: res.status,
      response: res.data,
      error: `HTTP ${res.status}`,
    };
  } catch (err) {
    const msg = err.code === 'ECONNABORTED' ? 'Request timeout' : err.message;
    logger.error('Distro request failed', {
      feedItemId: item.feedItemId,
      error: msg,
      responseStatus: err.response?.status,
      responseData: err.response?.data,
    });
    return {
      success: false,
      status: null,
      response: null,
      error: msg,
    };
  }
}

function isAlreadyPublished(db, feedItemId) {
  const row = db.prepare('SELECT 1 FROM published_items WHERE feed_item_id = ?').get(feedItemId);
  return !!row;
}

async function publishNewItems(items, dryRun = false) {
  const db = getDb();
  const results = { sent: 0, failed: 0 };

  for (const item of items) {
    if (isAlreadyPublished(db, item.feedItemId)) {
      logger.debug('Skip already published', { feedItemId: item.feedItemId });
      continue;
    }

    const result = await publishOne(item, dryRun);
    if (!result.skipRecord) {
      recordItem(db, item, result);
    }

    if (result.success) {
      results.sent++;
    } else {
      results.failed++;
    }
  }

  return results;
}

module.exports = {
  publishOne,
  publishNewItems,
  isAlreadyPublished,
  buildPayload,
};
