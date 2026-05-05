'use strict';

const Parser = require('rss-parser');
const config = require('./config');
const logger = require('./logger');
const { getStableId, normalizeUrl, stripHtml, wrapInParagraphs } = require('./utils/normalize');

const parser = new Parser({
  timeout: config.requestTimeoutMs,
  headers: { 'User-Agent': 'newsload-rss-publisher/1.0' },
});

function parseDate(val) {
  if (!val) return null;
  try {
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d.toISOString();
  } catch {
    return null;
  }
}

function getBody(item) {
  const snippet = item?.contentSnippet?.trim();
  if (snippet) return wrapInParagraphs(snippet);

  const content = item?.content?.trim();
  if (content) return wrapInParagraphs(stripHtml(content));

  return '<p>New post from Kite AI. Read more at the link.</p>';
}

function normalizeItem(item) {
  const title = item?.title?.trim();
  const link = item?.link ? normalizeUrl(item.link) : '';

  if (!title || !link) return null;

  const publishedAt = parseDate(item.pubDate || item.isoDate);
  const stableId = getStableId(item);
  const body = getBody(item);

  return {
    feedItemId: stableId,
    title,
    link,
    publishedAt,
    body,
  };
}

function dedupeByFeedItemId(items) {
  const seen = new Set();
  return items.filter((it) => {
    if (seen.has(it.feedItemId)) return false;
    seen.add(it.feedItemId);
    return true;
  });
}

async function fetchAndNormalize(feedUrl, maxItems = 20) {
  const feed = await parser.parseURL(feedUrl);
  const rawItems = feed?.items ?? [];

  const normalized = rawItems
    .map(normalizeItem)
    .filter(Boolean);

  const deduped = dedupeByFeedItemId(normalized);
  const sorted = deduped.sort((a, b) =>
    new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0)
  );

  return sorted.slice(0, maxItems);
}

async function fetchFeed(feedUrl, maxItems = 20) {
  try {
    const items = await fetchAndNormalize(feedUrl, maxItems);
    logger.debug('RSS fetch complete', { count: items.length, feedUrl });
    return { items, error: null };
  } catch (err) {
    logger.error('RSS fetch failed', { feedUrl, message: err.message });
    return { items: [], error: err };
  }
}

module.exports = { fetchFeed };
