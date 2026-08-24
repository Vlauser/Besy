'use strict';

/**
 * Personal blocks. A block is one-directional and private: the blocked account
 * is never told, it simply stops being able to reach the person who blocked it.
 *
 * Enforcement lives at the points where one account can put something in front
 * of another — comments, live chat, subscriptions and channel feeds — rather
 * than in a single middleware, because each surface fails differently.
 */

const { db } = require('./db');

/** True when `blockerId` has blocked `blockedId`. */
function isBlocked(blockerId, blockedId) {
  if (!blockerId || !blockedId || blockerId === blockedId) return false;
  return !!db.prepare('SELECT 1 FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?')
    .get(blockerId, blockedId);
}

/**
 * True when either side has blocked the other. Used where contact is mutual —
 * a comment reaches the channel owner, and the owner's reply reaches back.
 */
function eitherBlocked(a, b) {
  if (!a || !b || a === b) return false;
  return !!db.prepare(`
    SELECT 1 FROM user_blocks
    WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)
  `).get(a, b, b, a);
}

/** Ids this user has blocked, for filtering lists in one pass. */
function blockedIds(userId) {
  if (!userId) return new Set();
  return new Set(db.prepare('SELECT blocked_id FROM user_blocks WHERE blocker_id = ?')
    .all(userId).map((r) => r.blocked_id));
}

function block(blockerId, blockedId) {
  if (blockerId === blockedId) return false;
  db.prepare('INSERT OR IGNORE INTO user_blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)')
    .run(blockerId, blockedId, Date.now());
  // A block also severs the subscription in both directions: staying subscribed
  // would keep pushing the other person's uploads into the feed.
  db.prepare('DELETE FROM subscriptions WHERE (channel_id = ? AND subscriber_id = ?) OR (channel_id = ? AND subscriber_id = ?)')
    .run(blockerId, blockedId, blockedId, blockerId);
  return true;
}

function unblock(blockerId, blockedId) {
  const info = db.prepare('DELETE FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?')
    .run(blockerId, blockedId);
  return info.changes > 0;
}

function list(userId) {
  return db.prepare(`
    SELECT u.id, u.username, b.created_at
    FROM user_blocks b JOIN users u ON u.id = b.blocked_id
    WHERE b.blocker_id = ? ORDER BY b.created_at DESC
  `).all(userId);
}

module.exports = { isBlocked, eitherBlocked, blockedIds, block, unblock, list };
