'use strict';

const { db } = require('./db');

/**
 * Notification types the UI knows how to render.
 * Everything else falls back to the stored body text.
 */
const TYPES = new Set([
  'new_video', 'comment', 'reply', 'live_started',
  'strike', 'video_blocked', 'video_ready', 'copyright',
]);

function notify({ userId, type, actorId = null, videoId = null, body = '' }) {
  if (!userId || !TYPES.has(type)) return;
  // Nobody needs a notification about their own action.
  if (actorId && actorId === userId) return;

  db.prepare(`
    INSERT INTO notifications (user_id, type, actor_id, video_id, body, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(userId, type, actorId, videoId, String(body).slice(0, 300), Date.now());
}

/** Fans a notification out to every subscriber of a channel. */
function notifySubscribers({ channelId, type, videoId, body }) {
  const subscribers = db.prepare('SELECT subscriber_id FROM subscriptions WHERE channel_id = ?')
    .all(channelId);

  const insert = db.prepare(`
    INSERT INTO notifications (user_id, type, actor_id, video_id, body, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const now = Date.now();
  for (const row of subscribers) {
    if (row.subscriber_id === channelId) continue;
    insert.run(row.subscriber_id, type, channelId, videoId, String(body).slice(0, 300), now);
  }
  return subscribers.length;
}

function unreadCount(userId) {
  return db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL')
    .get(userId).n;
}

module.exports = { notify, notifySubscribers, unreadCount, TYPES };
