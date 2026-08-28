'use strict';

/** Community posts: short text updates on a channel, with likes. */

const express = require('express');
const crypto = require('node:crypto');

const { db } = require('../db');
const { requireAuth, requireVerifiedEmail } = require('../auth');
const { rateLimit } = require('../security');

const router = express.Router();

const postLimit = rateLimit({
  name: 'post',
  limit: Number(process.env.BESY_POST_RATE_LIMIT) || 10,
  windowMs: 60 * 60 * 1000,
  message: 'Слишком много записей за час',
  keyFn: (req) => (req.user ? `u${req.user.id}` : req.ip),
});

function shapePost(row, viewer) {
  return {
    id: row.id,
    body: row.body,
    createdAt: row.created_at,
    likes: row.likes ?? 0,
    liked: Boolean(row.liked),
    isOwner: Boolean(viewer && viewer.id === row.user_id),
    author: { id: row.user_id, username: row.username, displayName: row.display_name },
  };
}

const SELECT = `
  SELECT p.*, u.username, u.display_name, u.avatar_file,
         (SELECT COUNT(*) FROM post_likes l WHERE l.post_id = p.id) AS likes
  FROM posts p JOIN users u ON u.id = p.user_id
`;

router.get('/', (req, res) => {
  const channel = String(req.query.channel || '').trim();
  if (!channel) return res.status(400).json({ error: 'Не указан канал' });

  const rows = db.prepare(`${SELECT} WHERE lower(u.username) = lower(?) ORDER BY p.created_at DESC LIMIT 50`)
    .all(channel);

  const liked = req.user
    ? new Set(db.prepare('SELECT post_id FROM post_likes WHERE user_id = ?')
        .all(req.user.id).map((row) => row.post_id))
    : new Set();

  res.json({
    posts: rows.map((row) => shapePost({ ...row, liked: liked.has(row.id) }, req.user)),
  });
});

router.post('/', requireAuth, requireVerifiedEmail, postLimit, (req, res) => {
  const body = String(req.body.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Пустая запись' });
  if (body.length > 2000) return res.status(400).json({ error: 'Запись длиннее 2000 символов' });

  const id = crypto.randomBytes(9).toString('base64url');
  db.prepare('INSERT INTO posts (id, user_id, body, created_at) VALUES (?, ?, ?, ?)')
    .run(id, req.user.id, body, Date.now());

  const row = db.prepare(`${SELECT} WHERE p.id = ?`).get(id);
  res.status(201).json({ post: shapePost(row, req.user) });
});

router.post('/:id/like', requireAuth, (req, res) => {
  const post = db.prepare('SELECT id FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: 'Запись не найдена' });

  const existing = db.prepare('SELECT 1 FROM post_likes WHERE post_id = ? AND user_id = ?')
    .get(post.id, req.user.id);

  if (existing) {
    db.prepare('DELETE FROM post_likes WHERE post_id = ? AND user_id = ?').run(post.id, req.user.id);
  } else {
    db.prepare('INSERT INTO post_likes (post_id, user_id, created_at) VALUES (?, ?, ?)')
      .run(post.id, req.user.id, Date.now());
  }

  const likes = db.prepare('SELECT COUNT(*) AS n FROM post_likes WHERE post_id = ?').get(post.id).n;
  res.json({ liked: !existing, likes });
});

router.delete('/:id', requireAuth, (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: 'Запись не найдена' });
  if (post.user_id !== req.user.id && !req.user.isAdmin) {
    return res.status(403).json({ error: 'Это не ваша запись' });
  }

  db.prepare('DELETE FROM posts WHERE id = ?').run(post.id);
  res.json({ ok: true });
});

module.exports = router;
