'use strict';

const express = require('express');
const crypto = require('node:crypto');

const { db } = require('../db');
const { requireAuth } = require('../auth');
const { viewerKey, signMedia, SIGNED_MEDIA } = require('../security');

const router = express.Router();

function shapePlaylist(row, viewer) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    visibility: row.visibility,
    count: row.item_count ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isOwner: Boolean(viewer && viewer.id === row.user_id),
    cover: row.cover_id ? `/media/thumb/${row.cover_id}` : null,
    firstVideoId: row.cover_id || null,
    author: { id: row.user_id, username: row.username, displayName: row.display_name },
  };
}

const LIST_SELECT = `
  SELECT p.*, u.username, u.display_name,
         (SELECT COUNT(*) FROM playlist_items i WHERE i.playlist_id = p.id) AS item_count,
         (SELECT i.video_id FROM playlist_items i
           JOIN videos v ON v.id = i.video_id
          WHERE i.playlist_id = p.id AND v.blocked_at IS NULL
          ORDER BY i.position LIMIT 1) AS cover_id
  FROM playlists p JOIN users u ON u.id = p.user_id
`;

function canView(row, user) {
  if (row.visibility === 'public' || row.visibility === 'unlisted') return true;
  return Boolean(user && user.id === row.user_id);
}

/* -------------------------------------------------------------------- CRUD */

// GET /api/playlists?channel=username  — public playlists of a channel
router.get('/', (req, res) => {
  const channel = String(req.query.channel || '').trim();
  if (!channel) return res.status(400).json({ error: 'Не указан канал' });

  const isSelf = req.user && req.user.username.toLowerCase() === channel.toLowerCase();
  const rows = db.prepare(`
    ${LIST_SELECT}
    WHERE lower(u.username) = lower(?) AND (p.visibility = 'public' OR ? = 1)
      AND p.system IS NULL
    ORDER BY p.updated_at DESC
  `).all(channel, isSelf ? 1 : 0);

  res.json({ playlists: rows.map((row) => shapePlaylist(row, req.user)) });
});

// GET /api/playlists/mine — everything the current user owns, with membership flags
router.get('/mine', requireAuth, (req, res) => {
  const videoId = String(req.query.videoId || '');
  const rows = db.prepare(`${LIST_SELECT} WHERE p.user_id = ? AND p.system IS NULL ORDER BY p.updated_at DESC`)
    .all(req.user.id);

  const containing = videoId
    ? new Set(db.prepare('SELECT playlist_id FROM playlist_items WHERE video_id = ?')
        .all(videoId).map((row) => row.playlist_id))
    : new Set();

  res.json({
    playlists: rows.map((row) => ({
      ...shapePlaylist(row, req.user),
      contains: containing.has(row.id),
    })),
  });
});

router.post('/', requireAuth, (req, res) => {
  const title = String(req.body.title || '').trim();
  if (!title || title.length > 140) return res.status(400).json({ error: 'Название: 1–140 символов' });

  const visibility = ['public', 'unlisted', 'private'].includes(req.body.visibility)
    ? req.body.visibility
    : 'public';
  const description = String(req.body.description || '').slice(0, 2000);
  const id = crypto.randomBytes(9).toString('base64url');
  const now = Date.now();

  db.prepare(`
    INSERT INTO playlists (id, user_id, title, description, visibility, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, req.user.id, title, description, visibility, now, now);

  // A brand-new playlist can be created straight from a video.
  if (req.body.videoId) {
    const video = db.prepare('SELECT id FROM videos WHERE id = ?').get(String(req.body.videoId));
    if (video) {
      db.prepare(`
        INSERT INTO playlist_items (playlist_id, video_id, position, added_at) VALUES (?, ?, 0, ?)
      `).run(id, video.id, now);
    }
  }

  const row = db.prepare(`${LIST_SELECT} WHERE p.id = ?`).get(id);
  res.status(201).json({ playlist: shapePlaylist(row, req.user) });
});

router.get('/:id', (req, res) => {
  const row = db.prepare(`${LIST_SELECT} WHERE p.id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Плейлист не найден' });
  if (!canView(row, req.user)) return res.status(403).json({ error: 'Плейлист приватный' });

  const isOwner = req.user && req.user.id === row.user_id;
  const items = db.prepare(`
    SELECT v.*, u.username, u.display_name, i.position
    FROM playlist_items i
    JOIN videos v ON v.id = i.video_id
    JOIN users u ON u.id = v.user_id
    WHERE i.playlist_id = ?
      AND (v.visibility != 'private' OR v.user_id = ?)
      AND (v.blocked_at IS NULL OR v.user_id = ?)
    ORDER BY i.position, i.added_at
  `).all(row.id, req.user?.id ?? -1, req.user?.id ?? -1);

  res.json({
    playlist: shapePlaylist(row, req.user),
    videos: items.map((video) => ({
      id: video.id,
      title: video.title,
      duration: video.duration,
      views: video.views,
      createdAt: video.created_at,
      position: video.position,
      thumbUrl: video.thumb_key ? `/media/thumb/${video.id}` : null,
      streamUrl: `/media/stream/${video.id}${SIGNED_MEDIA ? `?token=${signMedia(video.id, viewerKey(req)).token}` : ''}`,
      hlsUrl: video.hls_master
        ? `/media/hls/${video.id}/master.m3u8${SIGNED_MEDIA ? `?token=${signMedia(video.id, viewerKey(req)).token}` : ''}`
        : null,
      author: { id: video.user_id, username: video.username, displayName: video.display_name },
    })),
    isOwner: Boolean(isOwner),
  });
});

router.patch('/:id', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM playlists WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Плейлист не найден' });
  if (row.user_id !== req.user.id) return res.status(403).json({ error: 'Это не ваш плейлист' });

  const title = String(req.body.title ?? row.title).trim();
  if (!title || title.length > 140) return res.status(400).json({ error: 'Название: 1–140 символов' });

  const description = String(req.body.description ?? row.description).slice(0, 2000);
  const visibility = ['public', 'unlisted', 'private'].includes(req.body.visibility)
    ? req.body.visibility
    : row.visibility;

  db.prepare('UPDATE playlists SET title = ?, description = ?, visibility = ?, updated_at = ? WHERE id = ?')
    .run(title, description, visibility, Date.now(), row.id);

  const updated = db.prepare(`${LIST_SELECT} WHERE p.id = ?`).get(row.id);
  res.json({ playlist: shapePlaylist(updated, req.user) });
});

router.delete('/:id', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM playlists WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Плейлист не найден' });
  if (row.user_id !== req.user.id) return res.status(403).json({ error: 'Это не ваш плейлист' });

  db.prepare('DELETE FROM playlists WHERE id = ?').run(row.id);
  res.json({ ok: true });
});

/* ------------------------------------------------------------------- items */

router.post('/:id/items', requireAuth, (req, res) => {
  const playlist = db.prepare('SELECT * FROM playlists WHERE id = ?').get(req.params.id);
  if (!playlist) return res.status(404).json({ error: 'Плейлист не найден' });
  if (playlist.user_id !== req.user.id) return res.status(403).json({ error: 'Это не ваш плейлист' });

  const video = db.prepare('SELECT id, visibility, user_id FROM videos WHERE id = ?')
    .get(String(req.body.videoId || ''));
  if (!video) return res.status(404).json({ error: 'Видео не найдено' });
  if (video.visibility === 'private' && video.user_id !== req.user.id) {
    return res.status(403).json({ error: 'Это видео приватное' });
  }

  const exists = db.prepare('SELECT 1 FROM playlist_items WHERE playlist_id = ? AND video_id = ?')
    .get(playlist.id, video.id);
  if (exists) return res.status(409).json({ error: 'Видео уже в плейлисте' });

  const next = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM playlist_items WHERE playlist_id = ?')
    .get(playlist.id).pos;

  db.prepare('INSERT INTO playlist_items (playlist_id, video_id, position, added_at) VALUES (?, ?, ?, ?)')
    .run(playlist.id, video.id, next, Date.now());
  db.prepare('UPDATE playlists SET updated_at = ? WHERE id = ?').run(Date.now(), playlist.id);

  res.status(201).json({ ok: true, position: next });
});

router.delete('/:id/items/:videoId', requireAuth, (req, res) => {
  const playlist = db.prepare('SELECT * FROM playlists WHERE id = ?').get(req.params.id);
  if (!playlist) return res.status(404).json({ error: 'Плейлист не найден' });
  if (playlist.user_id !== req.user.id) return res.status(403).json({ error: 'Это не ваш плейлист' });

  const info = db.prepare('DELETE FROM playlist_items WHERE playlist_id = ? AND video_id = ?')
    .run(playlist.id, req.params.videoId);
  if (!info.changes) return res.status(404).json({ error: 'Видео не найдено в плейлисте' });

  db.prepare('UPDATE playlists SET updated_at = ? WHERE id = ?').run(Date.now(), playlist.id);
  res.json({ ok: true });
});

/** Accepts the full ordered list of video ids and rewrites positions. */
router.post('/:id/reorder', requireAuth, (req, res) => {
  const playlist = db.prepare('SELECT * FROM playlists WHERE id = ?').get(req.params.id);
  if (!playlist) return res.status(404).json({ error: 'Плейлист не найден' });
  if (playlist.user_id !== req.user.id) return res.status(403).json({ error: 'Это не ваш плейлист' });

  const order = Array.isArray(req.body.order) ? req.body.order.map(String) : null;
  if (!order) return res.status(400).json({ error: 'Не передан новый порядок' });

  const current = db.prepare('SELECT video_id FROM playlist_items WHERE playlist_id = ?')
    .all(playlist.id).map((row) => row.video_id);
  if (order.length !== current.length || !order.every((id) => current.includes(id))) {
    return res.status(400).json({ error: 'Порядок не соответствует содержимому плейлиста' });
  }

  const update = db.prepare('UPDATE playlist_items SET position = ? WHERE playlist_id = ? AND video_id = ?');
  db.exec('BEGIN');
  try {
    order.forEach((videoId, index) => update.run(index, playlist.id, videoId));
    db.prepare('UPDATE playlists SET updated_at = ? WHERE id = ?').run(Date.now(), playlist.id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  res.json({ ok: true });
});

module.exports = router;
