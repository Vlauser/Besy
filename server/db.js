'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.BESY_DATA_DIR
  ? path.resolve(process.env.BESY_DATA_DIR)
  : path.join(__dirname, '..', 'data');

const VIDEO_DIR = path.join(DATA_DIR, 'videos');
const THUMB_DIR = path.join(DATA_DIR, 'thumbs');
const AVATAR_DIR = path.join(DATA_DIR, 'avatars');

for (const dir of [DATA_DIR, VIDEO_DIR, THUMB_DIR, AVATAR_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

const db = new DatabaseSync(path.join(DATA_DIR, 'besy.db'));

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE,
  email         TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  display_name  TEXT    NOT NULL,
  about         TEXT    NOT NULL DEFAULT '',
  avatar_file   TEXT,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT    PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS videos (
  id            TEXT    PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title         TEXT    NOT NULL,
  description   TEXT    NOT NULL DEFAULT '',
  tags          TEXT    NOT NULL DEFAULT '',
  visibility    TEXT    NOT NULL DEFAULT 'public',
  file_name     TEXT    NOT NULL,
  file_size     INTEGER NOT NULL,
  mime_type     TEXT    NOT NULL,
  duration      REAL    NOT NULL DEFAULT 0,
  width         INTEGER NOT NULL DEFAULT 0,
  height        INTEGER NOT NULL DEFAULT 0,
  thumb_file    TEXT,
  views         INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS video_views (
  video_id   TEXT    NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  viewer_key TEXT    NOT NULL,
  viewed_at  INTEGER NOT NULL,
  PRIMARY KEY (video_id, viewer_key)
);

CREATE TABLE IF NOT EXISTS reactions (
  video_id   TEXT    NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  value      INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (video_id, user_id)
);

CREATE TABLE IF NOT EXISTS comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id   TEXT    NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT    NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS subscriptions (
  channel_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subscriber_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (channel_id, subscriber_id)
);

CREATE INDEX IF NOT EXISTS idx_videos_user    ON videos(user_id);
CREATE INDEX IF NOT EXISTS idx_videos_created ON videos(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_videos_views   ON videos(views DESC);
CREATE INDEX IF NOT EXISTS idx_comments_video ON comments(video_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_user  ON sessions(user_id);
`);

module.exports = { db, DATA_DIR, VIDEO_DIR, THUMB_DIR, AVATAR_DIR };
