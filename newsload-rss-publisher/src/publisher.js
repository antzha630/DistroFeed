'use strict';

const axios = require('axios');
const config = require('./config');
const logger = require('./logger');
const { getDb } = require('./db');

/**
 * Distro story settings expose "Published date" vs "Custom date"; backends often accept
 * one of several JSON keys. Unknown keys are typically ignored, so we mirror common names.
 */
function attachSourcePublishDates(payload, iso) {
  if (!iso) return;
  payload.published_date = iso;
  payload.published_at = iso;
  payload.publishedAt = iso;
  payload.custom_date = iso;
  payload.customDate = iso;
  payload.original_publication_date = iso;
  const d = new Date(iso);
  if (!isNaN(d.getTime())) {
    payload.display_date = d.toISOString().slice(0, 10);
  }
  // Some APIs only map nested metadata; Distro may need to whitelist one of these.
  payload.metadata = {
    ...(payload.metadata || {}),
    published_at: iso,
    sourcePublishedAt: iso,
    originalPublishedAt: iso,
  };
  payload.story = {
    ...(payload.story || {}),
    published_at: iso,
    publishedAt: iso,
    custom_date: iso,
  };
}

function buildPayload(item, options = {}) {
  const includePublicationDate = options.includePublicationDate !== false;
  const payload = {
    user_info: { name: 'Kite AI RSS Bot' },
    title: item.title,
    content: item.body,
    more_info_url: item.link,
    source: 'Kite AI',
  };

  if (includePublicationDate && item.publishedAt) {
    attachSourcePublishDates(payload, item.publishedAt);
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
  return publishOneWithOptions(item, dryRun, {
    apiEndpoint: config.distro.apiEndpoint,
    apiKey: config.distro.apiKey,
  });
}

async function publishOneWithOptions(item, dryRun = false, options = {}) {
  const apiEndpoint = options.apiEndpoint || config.distro.apiEndpoint;
  const apiKey = options.apiKey || config.distro.apiKey;

  if (dryRun) {
    logger.info('DRY_RUN: would publish', { feedItemId: item.feedItemId, title: item.title });
    return { success: true, status: 0, response: null, dryRun: true, skipRecord: true };
  }

  const payload = buildPayload(item, { includePublicationDate: true });
  const fallbackPayload = buildPayload(item, { includePublicationDate: false });

  try {
    let res = await axios.post(apiEndpoint, payload, {
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
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
      res = await axios.post(apiEndpoint, fallbackPayload, {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
        },
        timeout: config.requestTimeoutMs,
        validateStatus: () => true,
      });
    }

    if (res.status >= 200 && res.status < 300) {
      logger.info('Published to Distro', {
        feedItemId: item.feedItemId,
        status: res.status,
        sourcePublishedAt: item.publishedAt || null,
      });
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
  return publishNewItemsWithOptions(items, dryRun, {});
}

async function publishNewItemsWithOptions(items, dryRun = false, options = {}) {
  const db = getDb();
  const results = { sent: 0, failed: 0, skipped: 0, itemResults: [] };

  for (const item of items) {
    if (isAlreadyPublished(db, item.feedItemId)) {
      logger.debug('Skip already published', { feedItemId: item.feedItemId });
      results.skipped++;
      results.itemResults.push({
        feedItemId: item.feedItemId,
        title: item.title,
        sourcePublishedAt: item.publishedAt || null,
        status: 'skipped',
        reason: 'already_published',
      });
      continue;
    }

    const result = await publishOneWithOptions(item, dryRun, options);
    if (!result.skipRecord) {
      recordItem(db, item, result);
    }

    if (result.success) {
      results.sent++;
      results.itemResults.push({
        feedItemId: item.feedItemId,
        title: item.title,
        sourcePublishedAt: item.publishedAt || null,
        status: 'sent',
        httpStatus: result.status ?? null,
      });
    } else {
      results.failed++;
      results.itemResults.push({
        feedItemId: item.feedItemId,
        title: item.title,
        sourcePublishedAt: item.publishedAt || null,
        status: 'failed',
        httpStatus: result.status ?? null,
        error: result.error || 'Unknown error',
      });
    }
  }

  return results;
}

module.exports = {
  publishOne,
  publishOneWithOptions,
  publishNewItems,
  publishNewItemsWithOptions,
  isAlreadyPublished,
  buildPayload,
};
