'use strict';

const express = require('express');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { db } = require('../db');
const { requireAuth, requireVerifiedEmail } = require('../auth');
const { rateLimit } = require('../security');
const live = require('../live');
const blocks = require('../blocks');

const router = express.Router();

const chatLimit = rateLimit({
  name: 'chat',
  limit: Number(process.env.BESY_CHAT_RATE_LIMIT) || 20,
  windowMs: 60 * 1000,
  message: 'Слишком быстро — подождите немного',
  keyFn: (req) => (req.user ? `u${req.user.id}` : req.ip),
});

function ingestUrl(req) {
  const host = process.env.BESY_RTMP_HOST || req.hostname;
  const port = Number(process.env.BESY_RTMP_PORT) || 1935;
  return `rtmp://${host}:${port}/live`;
}

function shapeStream(row, req, { withKey = false } = {}) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    visibility: row.visibility,
    liveStatus: row.live_status,
    createdAt: row.created_at,
    thumbUrl: row.thumb_key ? `/media/thumb/${row.id}` : null,
    hlsUrl: `/media/live/${row.id}/index.m3u8`,
    watchUrl: `/watch/${row.id}`,
    ...(withKey ? { streamKey: row.stream_key, ingestUrl: ingestUrl(req) } : {}),
  };
}

router.get('/config', (req, res) => {
  res.json({ enabled: live.ENABLED, ingestUrl: ingestUrl(req) });
});

// GET /api/live — streams that are on air right now
router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT v.*, u.username, u.display_name, u.avatar_file FROM videos v JOIN users u ON u.id = v.user_id
    WHERE v.kind = 'live' AND v.live_status = 'live'
      AND v.visibility = 'public' AND v.blocked_at IS NULL
    ORDER BY v.created_at DESC LIMIT 40
  `).all();

  res.json({
    streams: rows.map((row) => ({
      ...shapeStream(row, req),
      author: { id: row.user_id, username: row.username, displayName: row.display_name },
    })),
  });
});

// GET /api/live/mine — the owner's streams, including their secret keys
router.get('/mine', requireAuth, (req, res) => {
  const rows = db.prepare("SELECT * FROM videos WHERE user_id = ? AND kind = 'live' ORDER BY created_at DESC")
    .all(req.user.id);
  res.json({ streams: rows.map((row) => shapeStream(row, req, { withKey: true })) });
});

// POST /api/live — create a stream slot and issue an ingest key
router.post('/', requireAuth, requireVerifiedEmail, (req, res) => {
  if (!live.ENABLED) return res.status(503).json({ error: 'Эфиры на этом сервере выключены' });

  const title = String(req.body.title || '').trim();
  if (!title || title.length > 140) return res.status(400).json({ error: 'Заголовок: 1–140 символов' });

  const visibility = ['public', 'unlisted', 'private'].includes(req.body.visibility)
    ? req.body.visibility
    : 'public';

  const id = crypto.randomBytes(9).toString('base64url');
  const streamKey = crypto.randomBytes(16).toString('hex');

  db.prepare(`
    INSERT INTO videos (id, user_id, title, description, tags, visibility, file_key, file_size,
                        mime_type, status, kind, live_status, stream_key, created_at)
    VALUES (?, ?, ?, ?, '', ?, '', 0, 'application/vnd.apple.mpegurl', 'ready', 'live', 'idle', ?, ?)
  `).run(id, req.user.id, title, String(req.body.description || '').slice(0, 5000),
    visibility, streamKey, Date.now());

  const row = db.prepare('SELECT * FROM videos WHERE id = ?').get(id);
  res.status(201).json({ stream: shapeStream(row, req, { withKey: true }) });
});

// POST /api/live/:id/key — roll the ingest key
router.post('/:id/key', requireAuth, (req, res) => {
  const row = db.prepare("SELECT * FROM videos WHERE id = ? AND kind = 'live'").get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Трансляция не найдена' });
  if (row.user_id !== req.user.id) return res.status(403).json({ error: 'Это не ваша трансляция' });

  const streamKey = crypto.randomBytes(16).toString('hex');
  db.prepare('UPDATE videos SET stream_key = ? WHERE id = ?').run(streamKey, row.id);
  live.stopEncoder(row.id);

  const updated = db.prepare('SELECT * FROM videos WHERE id = ?').get(row.id);
  res.json({ stream: shapeStream(updated, req, { withKey: true }) });
});

router.post('/:id/stop', requireAuth, (req, res) => {
  const row = db.prepare("SELECT * FROM videos WHERE id = ? AND kind = 'live'").get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Трансляция не найдена' });
  if (row.user_id !== req.user.id && !req.user.isAdmin) {
    return res.status(403).json({ error: 'Это не ваша трансляция' });
  }

  live.stopEncoder(row.id);
  db.prepare("UPDATE videos SET live_status = 'ended' WHERE id = ?").run(row.id);
  res.json({ ok: true });
});

/* ---------------------------------------------------------------- live chat */

router.get('/:id/chat', (req, res) => {
  const video = db.prepare('SELECT id, visibility, user_id FROM videos WHERE id = ?').get(req.params.id);
  if (!video) return res.status(404).json({ error: 'Трансляция не найдена' });
  if (video.visibility === 'private' && video.user_id !== req.user?.id) {
    return res.status(403).json({ error: 'Трансляция приватная' });
  }

  const after = Number(req.query.after) || 0;
  const rows = db.prepare(`
    SELECT m.*, u.username, u.display_name, u.avatar_file FROM live_messages m
    JOIN users u ON u.id = m.user_id
    WHERE m.video_id = ? AND m.id > ?
    ORDER BY m.id LIMIT 200
  `).all(video.id, after);

  res.json({
    messages: rows.map((row) => ({
      id: row.id,
      body: row.body,
      createdAt: row.created_at,
      author: { id: row.user_id, username: row.username, displayName: row.display_name },
    })),
  });
});

router.post('/:id/chat', requireAuth, requireVerifiedEmail, chatLimit, (req, res) => {
  const video = db.prepare('SELECT id, user_id, live_status FROM videos WHERE id = ?').get(req.params.id);
  if (!video) return res.status(404).json({ error: 'Трансляция не найдена' });
  if (blocks.eitherBlocked(video.user_id, req.user.id)) {
    return res.status(403).json({ error: 'Чат для вас недоступен на этом канале' });
  }

  const body = String(req.body.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Пустое сообщение' });
  if (body.length > 300) return res.status(400).json({ error: 'Сообщение длиннее 300 символов' });

  const info = db.prepare('INSERT INTO live_messages (video_id, user_id, body, created_at) VALUES (?, ?, ?, ?)')
    .run(video.id, req.user.id, body, Date.now());

  res.status(201).json({
    message: {
      id: Number(info.lastInsertRowid),
      body,
      createdAt: Date.now(),
      author: { id: req.user.id, username: req.user.username, displayName: req.user.displayName },
    },
  });
});

router.delete('/:id/chat/:messageId', requireAuth, (req, res) => {
  const row = db.prepare(`
    SELECT m.*, v.user_id AS streamer FROM live_messages m JOIN videos v ON v.id = m.video_id
    WHERE m.id = ? AND m.video_id = ?
  `).get(Number(req.params.messageId), req.params.id);

  if (!row) return res.status(404).json({ error: 'Сообщение не найдено' });
  if (row.user_id !== req.user.id && row.streamer !== req.user.id && !req.user.isAdmin) {
    return res.status(403).json({ error: 'Нельзя удалить чужое сообщение' });
  }

  db.prepare('DELETE FROM live_messages WHERE id = ?').run(row.id);
  res.json({ ok: true });
});

module.exports = router;
