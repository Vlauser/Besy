'use strict';

const express = require('express');
const { db } = require('../db');
const { requireAuth } = require('../auth');
const blocks = require('../blocks');

const router = express.Router();

router.get('/:username', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE lower(username) = lower(?)').get(req.params.username);
  if (!user) return res.status(404).json({ error: 'Канал не найден' });

  const isOwner = Boolean(req.user && req.user.id === user.id);
  const stats = db.prepare(`
    SELECT COUNT(*) AS videos, COALESCE(SUM(views), 0) AS views
    FROM videos WHERE user_id = ? AND (visibility = 'public' OR ? = 1)
  `).get(user.id, isOwner ? 1 : 0);

  const subscribers = db.prepare('SELECT COUNT(*) AS n FROM subscriptions WHERE channel_id = ?').get(user.id).n;
  const subscribed = req.user
    ? Boolean(db.prepare('SELECT 1 FROM subscriptions WHERE channel_id = ? AND subscriber_id = ?')
        .get(user.id, req.user.id))
    : false;

  res.json({
    channel: {
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      about: user.about,
      createdAt: user.created_at,
      videos: stats.videos,
      views: stats.views,
      subscribers,
      subscribed,
      isOwner,
    },
  });
});

router.post('/:username/subscribe', requireAuth, (req, res) => {
  const user = db.prepare('SELECT id FROM users WHERE lower(username) = lower(?)').get(req.params.username);
  if (!user) return res.status(404).json({ error: 'Канал не найден' });
  if (user.id === req.user.id) return res.status(400).json({ error: 'Нельзя подписаться на себя' });
  if (blocks.eitherBlocked(user.id, req.user.id)) {
    return res.status(403).json({ error: 'Подписка на этот канал недоступна' });
  }

  const existing = db.prepare('SELECT 1 FROM subscriptions WHERE channel_id = ? AND subscriber_id = ?')
    .get(user.id, req.user.id);

  if (existing) {
    db.prepare('DELETE FROM subscriptions WHERE channel_id = ? AND subscriber_id = ?')
      .run(user.id, req.user.id);
  } else {
    db.prepare('INSERT INTO subscriptions (channel_id, subscriber_id, created_at) VALUES (?, ?, ?)')
      .run(user.id, req.user.id, Date.now());
  }

  const subscribers = db.prepare('SELECT COUNT(*) AS n FROM subscriptions WHERE channel_id = ?').get(user.id).n;
  res.json({ subscribed: !existing, subscribers });
});

// Feed of videos from channels the current user follows.
router.get('/me/feed', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT v.*, u.username, u.display_name,
           (SELECT COUNT(*) FROM reactions r WHERE r.video_id = v.id AND r.value = 1) AS likes
    FROM videos v
    JOIN users u ON u.id = v.user_id
    JOIN subscriptions s ON s.channel_id = v.user_id
    WHERE s.subscriber_id = ? AND v.visibility = 'public'
    ORDER BY v.created_at DESC
    LIMIT 48
  `).all(req.user.id);

  res.json({
    videos: rows.map((row) => ({
      id: row.id,
      title: row.title,
      views: row.views,
      duration: row.duration,
      createdAt: row.created_at,
      likes: row.likes,
      thumbUrl: row.thumb_file ? `/media/thumb/${row.id}` : null,
      author: { id: row.user_id, username: row.username, displayName: row.display_name },
    })),
  });
});

module.exports = router;
