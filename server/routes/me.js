'use strict';

/**
 * Personal surfaces: notifications, watch history, Watch Later, recommendations,
 * plus the controls a person has over their own account — who may reach them,
 * what the service holds about them, and leaving.
 */

const express = require('express');
const crypto = require('node:crypto');

const { db } = require('../db');
const { requireAuth, verifyPassword } = require('../auth');
const blocks = require('../blocks');
const { rateLimit } = require('../security');
const { unreadCount } = require('../notifications');

const router = express.Router();

function shapeCard(row) {
  return {
    id: row.id,
    title: row.title,
    duration: row.duration,
    views: row.views,
    createdAt: row.created_at,
    isShort: row.is_short === 1,
    kind: row.kind,
    thumbUrl: row.thumb_key ? `/media/thumb/${row.id}` : null,
    author: { id: row.user_id, username: row.username, displayName: row.display_name },
  };
}

/* ---------------------------------------------------------- notifications */

router.get('/notifications', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT n.*, u.username AS actor_username, u.display_name AS actor_name,
           v.title AS video_title
    FROM notifications n
    LEFT JOIN users u ON u.id = n.actor_id
    LEFT JOIN videos v ON v.id = n.video_id
    WHERE n.user_id = ?
    ORDER BY n.created_at DESC LIMIT 60
  `).all(req.user.id);

  res.json({
    unread: unreadCount(req.user.id),
    notifications: rows.map((row) => ({
      id: row.id,
      type: row.type,
      body: row.body,
      videoId: row.video_id,
      videoTitle: row.video_title,
      actor: row.actor_username
        ? { username: row.actor_username, displayName: row.actor_name }
        : null,
      read: Boolean(row.read_at),
      createdAt: row.created_at,
    })),
  });
});

router.post('/notifications/read', requireAuth, (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number).filter(Boolean) : null;

  if (ids && ids.length) {
    const placeholders = ids.map(() => '?').join(',');
    db.prepare(`UPDATE notifications SET read_at = ? WHERE user_id = ? AND id IN (${placeholders})`)
      .run(Date.now(), req.user.id, ...ids);
  } else {
    db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL')
      .run(Date.now(), req.user.id);
  }

  res.json({ ok: true, unread: unreadCount(req.user.id) });
});

router.delete('/notifications', requireAuth, (req, res) => {
  db.prepare('DELETE FROM notifications WHERE user_id = ?').run(req.user.id);
  res.json({ ok: true });
});

/* --------------------------------------------------------------- history */

router.get('/history', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT v.*, u.username, u.display_name, h.position, h.updated_at AS watched_at
    FROM watch_history h
    JOIN videos v ON v.id = h.video_id
    JOIN users u ON u.id = v.user_id
    WHERE h.user_id = ? AND v.blocked_at IS NULL
    ORDER BY h.updated_at DESC LIMIT 60
  `).all(req.user.id);

  res.json({
    history: rows.map((row) => ({
      ...shapeCard(row),
      position: row.position,
      progress: row.duration ? Math.min(100, Math.round((row.position / row.duration) * 100)) : 0,
      watchedAt: row.watched_at,
    })),
  });
});

router.delete('/history', requireAuth, (req, res) => {
  if (req.query.videoId) {
    db.prepare('DELETE FROM watch_history WHERE user_id = ? AND video_id = ?')
      .run(req.user.id, String(req.query.videoId));
  } else {
    db.prepare('DELETE FROM watch_history WHERE user_id = ?').run(req.user.id);
  }
  res.json({ ok: true });
});

/* ---------------------------------------------------------- watch later */

/** The Watch Later list is an ordinary private playlist flagged as a system one. */
function watchLaterPlaylist(userId) {
  const existing = db.prepare("SELECT * FROM playlists WHERE user_id = ? AND system = 'watch_later'")
    .get(userId);
  if (existing) return existing;

  const id = crypto.randomBytes(9).toString('base64url');
  const now = Date.now();
  db.prepare(`
    INSERT INTO playlists (id, user_id, title, description, visibility, system, created_at, updated_at)
    VALUES (?, ?, 'Смотреть позже', '', 'private', 'watch_later', ?, ?)
  `).run(id, userId, now, now);

  return db.prepare('SELECT * FROM playlists WHERE id = ?').get(id);
}

router.get('/watch-later', requireAuth, (req, res) => {
  const playlist = watchLaterPlaylist(req.user.id);
  const rows = db.prepare(`
    SELECT v.*, u.username, u.display_name, i.added_at
    FROM playlist_items i
    JOIN videos v ON v.id = i.video_id
    JOIN users u ON u.id = v.user_id
    WHERE i.playlist_id = ? AND v.blocked_at IS NULL
    ORDER BY i.position DESC, i.added_at DESC
  `).all(playlist.id);

  res.json({ playlistId: playlist.id, videos: rows.map(shapeCard) });
});

router.post('/watch-later', requireAuth, (req, res) => {
  const playlist = watchLaterPlaylist(req.user.id);
  const video = db.prepare('SELECT id FROM videos WHERE id = ?').get(String(req.body.videoId || ''));
  if (!video) return res.status(404).json({ error: 'Видео не найдено' });

  const exists = db.prepare('SELECT 1 FROM playlist_items WHERE playlist_id = ? AND video_id = ?')
    .get(playlist.id, video.id);

  if (exists) {
    db.prepare('DELETE FROM playlist_items WHERE playlist_id = ? AND video_id = ?')
      .run(playlist.id, video.id);
    return res.json({ added: false });
  }

  const next = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM playlist_items WHERE playlist_id = ?')
    .get(playlist.id).pos;
  db.prepare('INSERT INTO playlist_items (playlist_id, video_id, position, added_at) VALUES (?, ?, ?, ?)')
    .run(playlist.id, video.id, next, Date.now());

  res.json({ added: true });
});

/* ------------------------------------------------------- recommendations */

/**
 * Ranks public videos by overlap with what this viewer already watched:
 * channels they returned to, tags they lingered on, plus freshness and reach.
 */
router.get('/recommended', requireAuth, (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 24, 1), 60);

  const history = db.prepare(`
    SELECT v.user_id, v.tags FROM watch_history h JOIN videos v ON v.id = h.video_id
    WHERE h.user_id = ? ORDER BY h.updated_at DESC LIMIT 40
  `).all(req.user.id);

  const channelWeight = new Map();
  const tagWeight = new Map();
  for (const row of history) {
    channelWeight.set(row.user_id, (channelWeight.get(row.user_id) || 0) + 1);
    for (const tag of String(row.tags || '').split(',').filter(Boolean)) {
      tagWeight.set(tag, (tagWeight.get(tag) || 0) + 1);
    }
  }

  const subscribed = new Set(
    db.prepare('SELECT channel_id FROM subscriptions WHERE subscriber_id = ?')
      .all(req.user.id).map((row) => row.channel_id)
  );
  const seen = new Set(
    db.prepare('SELECT video_id FROM watch_history WHERE user_id = ?')
      .all(req.user.id).map((row) => row.video_id)
  );

  const candidates = db.prepare(`
    SELECT v.*, u.username, u.display_name FROM videos v JOIN users u ON u.id = v.user_id
    WHERE v.visibility = 'public' AND v.blocked_at IS NULL AND v.is_short = 0
      AND (v.publish_at IS NULL OR v.publish_at <= ?)
    ORDER BY v.created_at DESC LIMIT 300
  `).all(Date.now());

  const now = Date.now();
  const scored = candidates
    .filter((row) => !seen.has(row.id))
    .map((row) => {
      const ageDays = (now - row.created_at) / 86400000;
      const tags = String(row.tags || '').split(',').filter(Boolean);
      const tagScore = tags.reduce((sum, tag) => sum + (tagWeight.get(tag) || 0), 0);

      const score =
        (channelWeight.get(row.user_id) || 0) * 3 +
        tagScore * 2 +
        (subscribed.has(row.user_id) ? 5 : 0) +
        Math.log10(row.views + 1) * 2 +
        Math.max(0, 5 - ageDays / 7);

      return { row, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  res.json({ videos: scored.map((entry) => shapeCard(entry.row)) });
});

/* --------------------------------------------------------------- blocks */

router.get('/blocks', requireAuth, (req, res) => {
  res.json({
    blocks: blocks.list(req.user.id).map((row) => ({
      username: row.username,
      createdAt: row.created_at,
    })),
  });
});

router.post('/blocks', requireAuth, (req, res) => {
  const target = db.prepare('SELECT id, username, is_admin FROM users WHERE lower(username) = lower(?)')
    .get(String(req.body.username || ''));
  if (!target) return res.status(404).json({ error: 'Пользователь не найден' });
  if (target.id === req.user.id) return res.status(400).json({ error: 'Нельзя заблокировать себя' });
  // Blocking a moderator would let anyone opt out of moderation contact.
  if (target.is_admin) return res.status(403).json({ error: 'Модератора заблокировать нельзя' });

  blocks.block(req.user.id, target.id);
  res.status(201).json({ ok: true, username: target.username });
});

router.delete('/blocks/:username', requireAuth, (req, res) => {
  const target = db.prepare('SELECT id FROM users WHERE lower(username) = lower(?)')
    .get(req.params.username);
  if (!target) return res.status(404).json({ error: 'Пользователь не найден' });

  const removed = blocks.unblock(req.user.id, target.id);
  if (!removed) return res.status(404).json({ error: 'Этот пользователь не заблокирован' });
  res.json({ ok: true });
});

/* ----------------------------------------------------------------- data */

const exportLimit = rateLimit({
  name: 'export',
  limit: Number(process.env.BESY_EXPORT_RATE_LIMIT) || 5,
  windowMs: 60 * 60 * 1000,
  message: 'Слишком много выгрузок за час',
  keyFn: (req) => (req.user ? `u${req.user.id}` : req.ip),
});

// Everything the service holds about the requester, in one JSON file. Secrets
// are deliberately absent: password hash, TOTP seed, backup codes and session
// tokens are credentials, not personal data to hand back.
router.get('/export', requireAuth, exportLimit, (req, res) => {
  const uid = req.user.id;
  const one = (sql, ...args) => db.prepare(sql).all(...args);

  const account = db.prepare(`
    SELECT username, email, created_at, email_verified_at, totp_enabled, strikes
    FROM users WHERE id = ?
  `).get(uid);

  const payload = {
    exportedAt: new Date().toISOString(),
    account,
    videos: one('SELECT id, title, description, visibility, created_at, views FROM videos WHERE user_id = ?', uid),
    comments: one('SELECT video_id, body, created_at FROM comments WHERE user_id = ?', uid),
    posts: one('SELECT body, created_at FROM posts WHERE user_id = ?', uid),
    playlists: one('SELECT id, title, visibility, created_at FROM playlists WHERE user_id = ?', uid),
    subscriptions: one(`
      SELECT u.username, s.created_at FROM subscriptions s
      JOIN users u ON u.id = s.channel_id WHERE s.subscriber_id = ?`, uid),
    subscribers: one('SELECT COUNT(*) AS total FROM subscriptions WHERE channel_id = ?', uid),
    watchHistory: one('SELECT video_id, position, updated_at FROM watch_history WHERE user_id = ?', uid),
    blocked: blocks.list(uid).map((r) => ({ username: r.username, createdAt: r.created_at })),
    sessions: one('SELECT ip, user_agent, created_at, last_seen_at FROM sessions WHERE user_id = ?', uid),
    strikes: one('SELECT reason, created_at, expires_at FROM strikes WHERE user_id = ?', uid),
  };

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="besy-export-${account.username}.json"`);
  res.send(JSON.stringify(payload, null, 2));
});

// Leaving. Requires the current password, because a hijacked session must not
// be able to destroy the account it stole.
router.delete('/account', requireAuth, (req, res) => {
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  if (!verifyPassword(String(req.body.password || ''), row.password_hash)) {
    return res.status(403).json({ error: 'Неверный пароль' });
  }

  // Foreign keys cascade from users, so videos, comments, sessions, blocks and
  // the rest go with the row. Moderation history keeps a null actor instead.
  db.prepare('DELETE FROM users WHERE id = ?').run(req.user.id);
  res.clearCookie('besy_session');
  res.json({ ok: true });
});

module.exports = router;
module.exports.watchLaterPlaylist = watchLaterPlaylist;
