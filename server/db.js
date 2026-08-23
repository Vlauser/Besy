'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.BESY_DATA_DIR
  ? path.resolve(process.env.BESY_DATA_DIR)
  : path.join(__dirname, '..', 'data');

const TMP_DIR = path.join(DATA_DIR, 'tmp');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(TMP_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'besy.db'));

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA busy_timeout = 5000');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE,
  email         TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  display_name  TEXT    NOT NULL,
  about         TEXT    NOT NULL DEFAULT '',
  avatar_file   TEXT,
  is_admin      INTEGER NOT NULL DEFAULT 0,
  banned_at     INTEGER,
  ban_reason    TEXT,
  email_verified_at INTEGER,
  totp_secret   TEXT,
  totp_enabled  INTEGER NOT NULL DEFAULT 0,
  backup_codes  TEXT NOT NULL DEFAULT '[]',
  strikes       INTEGER NOT NULL DEFAULT 0,
  password_changed_at INTEGER,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token        TEXT    PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ip           TEXT    NOT NULL DEFAULT '',
  user_agent   TEXT    NOT NULL DEFAULT '',
  last_seen_at INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS email_tokens (
  token      TEXT    PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose    TEXT    NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at    INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS strikes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  video_id   TEXT    REFERENCES videos(id) ON DELETE SET NULL,
  reason     TEXT    NOT NULL,
  note       TEXT    NOT NULL DEFAULT '',
  issued_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS copyright_claims (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id      TEXT    NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  claimant_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  claimant_name TEXT    NOT NULL,
  claimant_email TEXT   NOT NULL,
  work          TEXT    NOT NULL,
  statement     TEXT    NOT NULL,
  status        TEXT    NOT NULL DEFAULT 'open',
  resolution    TEXT,
  handled_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  handled_at    INTEGER,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS moderation_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT    NOT NULL,
  target_type TEXT    NOT NULL,
  target_id   TEXT    NOT NULL,
  details     TEXT    NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS videos (
  id             TEXT    PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title          TEXT    NOT NULL,
  description    TEXT    NOT NULL DEFAULT '',
  tags           TEXT    NOT NULL DEFAULT '',
  visibility     TEXT    NOT NULL DEFAULT 'public',
  file_key       TEXT    NOT NULL,
  file_size      INTEGER NOT NULL,
  mime_type      TEXT    NOT NULL,
  duration       REAL    NOT NULL DEFAULT 0,
  width          INTEGER NOT NULL DEFAULT 0,
  height         INTEGER NOT NULL DEFAULT 0,
  thumb_key      TEXT,
  views          INTEGER NOT NULL DEFAULT 0,
  status         TEXT    NOT NULL DEFAULT 'ready',
  status_error   TEXT,
  progress       INTEGER NOT NULL DEFAULT 0,
  hls_master     TEXT,
  renditions     TEXT    NOT NULL DEFAULT '[]',
  blocked_at     INTEGER,
  blocked_reason TEXT,
  age_restricted INTEGER NOT NULL DEFAULT 0,
  is_short       INTEGER NOT NULL DEFAULT 0,
  kind           TEXT    NOT NULL DEFAULT 'video',
  publish_at     INTEGER,
  live_status    TEXT,
  stream_key     TEXT,
  created_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS live_messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id   TEXT    NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT    NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS captions (
  id         TEXT    PRIMARY KEY,
  video_id   TEXT    NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  lang       TEXT    NOT NULL,
  label      TEXT    NOT NULL,
  file_key   TEXT    NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
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
  channel_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subscriber_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (channel_id, subscriber_id)
);

CREATE TABLE IF NOT EXISTS playlists (
  id          TEXT    PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT    NOT NULL,
  description TEXT    NOT NULL DEFAULT '',
  visibility  TEXT    NOT NULL DEFAULT 'public',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS playlist_items (
  playlist_id TEXT    NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  video_id    TEXT    NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL,
  added_at    INTEGER NOT NULL,
  PRIMARY KEY (playlist_id, video_id)
);

CREATE TABLE IF NOT EXISTS reports (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  target_type    TEXT    NOT NULL,
  video_id       TEXT    REFERENCES videos(id) ON DELETE CASCADE,
  comment_id     INTEGER REFERENCES comments(id) ON DELETE CASCADE,
  reporter_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reason         TEXT    NOT NULL,
  details        TEXT    NOT NULL DEFAULT '',
  status         TEXT    NOT NULL DEFAULT 'open',
  resolution     TEXT,
  handled_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  handled_at     INTEGER,
  created_at     INTEGER NOT NULL
);

`);

/**
 * Brings a database created by an older build up to the current schema.
 * Every step is guarded, so running it repeatedly is a no-op.
 */
function migrate() {
  const columns = (table) => new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));

  const videoColumns = columns('videos');
  if (videoColumns.has('file_name') && !videoColumns.has('file_key')) {
    db.exec('ALTER TABLE videos RENAME COLUMN file_name TO file_key');
  }
  if (videoColumns.has('thumb_file') && !videoColumns.has('thumb_key')) {
    db.exec('ALTER TABLE videos RENAME COLUMN thumb_file TO thumb_key');
  }

  const additions = [
    ['videos', 'status', "TEXT NOT NULL DEFAULT 'ready'"],
    ['videos', 'status_error', 'TEXT'],
    ['videos', 'progress', 'INTEGER NOT NULL DEFAULT 0'],
    ['videos', 'hls_master', 'TEXT'],
    ['videos', 'renditions', "TEXT NOT NULL DEFAULT '[]'"],
    ['videos', 'blocked_at', 'INTEGER'],
    ['videos', 'blocked_reason', 'TEXT'],
    ['users', 'is_admin', 'INTEGER NOT NULL DEFAULT 0'],
    ['users', 'banned_at', 'INTEGER'],
    ['users', 'ban_reason', 'TEXT'],
    ['users', 'email_verified_at', 'INTEGER'],
    ['users', 'totp_secret', 'TEXT'],
    ['users', 'totp_enabled', 'INTEGER NOT NULL DEFAULT 0'],
    ['users', 'backup_codes', "TEXT NOT NULL DEFAULT '[]'"],
    ['users', 'strikes', 'INTEGER NOT NULL DEFAULT 0'],
    ['users', 'password_changed_at', 'INTEGER'],
    ['videos', 'age_restricted', 'INTEGER NOT NULL DEFAULT 0'],
    ['videos', 'is_short', 'INTEGER NOT NULL DEFAULT 0'],
    ['videos', 'kind', "TEXT NOT NULL DEFAULT 'video'"],
    ['videos', 'publish_at', 'INTEGER'],
    ['videos', 'live_status', 'TEXT'],
    ['videos', 'stream_key', 'TEXT'],
    ['sessions', 'ip', "TEXT NOT NULL DEFAULT ''"],
    ['sessions', 'user_agent', "TEXT NOT NULL DEFAULT ''"],
    ['sessions', 'last_seen_at', 'INTEGER NOT NULL DEFAULT 0'],
  ];

  for (const [table, column, definition] of additions) {
    if (!columns(table).has(column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }

  // Legacy rows stored bare file names; storage keys are prefixed folders now.
  db.exec(`UPDATE videos SET file_key  = 'videos/' || file_key  WHERE file_key  NOT LIKE '%/%'`);
  db.exec(`UPDATE videos SET thumb_key = 'thumbs/' || thumb_key WHERE thumb_key IS NOT NULL AND thumb_key NOT LIKE '%/%'`);
}

migrate();

// Indexes come after the migration: some of them cover freshly added columns.
db.exec(`
CREATE INDEX IF NOT EXISTS idx_videos_user     ON videos(user_id);
CREATE INDEX IF NOT EXISTS idx_videos_created  ON videos(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_videos_views    ON videos(views DESC);
CREATE INDEX IF NOT EXISTS idx_videos_status   ON videos(status);
CREATE INDEX IF NOT EXISTS idx_comments_video  ON comments(video_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_user   ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_items_playlist  ON playlist_items(playlist_id, position);
CREATE INDEX IF NOT EXISTS idx_playlists_user  ON playlists(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_status  ON reports(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tokens_user     ON email_tokens(user_id, purpose);
CREATE INDEX IF NOT EXISTS idx_strikes_user    ON strikes(user_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_claims_status   ON copyright_claims(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_modlog_created  ON moderation_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_captions_video  ON captions(video_id);
CREATE INDEX IF NOT EXISTS idx_videos_short    ON videos(is_short, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_videos_publish  ON videos(publish_at);
CREATE INDEX IF NOT EXISTS idx_livemsg_video   ON live_messages(video_id, id);
`);

module.exports = { db, DATA_DIR, TMP_DIR };
