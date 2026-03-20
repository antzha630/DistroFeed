'use strict';

const path = require('path');
const Database = require('better-sqlite3');

const dataDir = process.env.DATA_PATH || path.join(process.cwd(), 'data');
const DB_PATH = path.join(dataDir, 'newsload-rss.db');

function ensureDir() {
  const fs = require('fs');
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function initDb() {
  ensureDir();
  const db = new Database(DB_PATH);

  db.exec(`
    CREATE TABLE IF NOT EXISTS published_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      feed_item_id TEXT UNIQUE NOT NULL,
      title TEXT,
      link TEXT,
      published_at TEXT,
      first_seen_at TEXT NOT NULL,
      sent_at TEXT,
      distro_status INTEGER,
      distro_response TEXT,
      error TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_published_items_feed_item_id
      ON published_items(feed_item_id);

    CREATE TABLE IF NOT EXISTS worker_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT,
      finished_at TEXT,
      items_fetched INTEGER,
      items_new INTEGER,
      items_sent INTEGER,
      items_failed INTEGER
    );
  `);

  return db;
}

let dbInstance = null;

function getDb() {
  if (!dbInstance) {
    dbInstance = initDb();
  }
  return dbInstance;
}

module.exports = { getDb, DB_PATH };
