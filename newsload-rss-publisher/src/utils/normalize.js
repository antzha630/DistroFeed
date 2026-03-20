'use strict';

const { sha256 } = require('./hash');

function stripHtml(html) {
  if (!html || typeof html !== 'string') return '';
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeUrl(url) {
  if (!url || typeof url !== 'string') return '';
  try {
    const u = new URL(url.trim());
    u.hash = '';
    return u.href;
  } catch {
    return url.trim();
  }
}

function wrapInParagraphs(text) {
  if (!text || typeof text !== 'string') return '';
  const trimmed = text.trim();
  if (!trimmed) return '';
  return `<p>${trimmed.replace(/\n\n+/g, '</p><p>').replace(/\n/g, ' ')}</p>`;
}

function getStableId(item) {
  if (item?.guid) {
    const g = String(item.guid).trim();
    if (g) return g;
  }
  const link = item?.link ? normalizeUrl(item.link) : '';
  if (link) return sha256(link);
  return sha256(JSON.stringify(item) || 'unknown');
}

module.exports = {
  stripHtml,
  normalizeUrl,
  wrapInParagraphs,
  getStableId,
};
