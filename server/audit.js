'use strict';

/**
 * The moderation audit trail. Every action a moderator or rights holder takes
 * against someone else's content lands here, so decisions can be reviewed after
 * the fact. Kept in its own module because more than one router writes to it.
 */

const { db } = require('./db');

function logAction(actorId, action, targetType, targetId, details = '') {
  db.prepare(`
    INSERT INTO moderation_log (actor_id, action, target_type, target_id, details, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(actorId, action, targetType, String(targetId), String(details).slice(0, 1000), Date.now());
}

module.exports = { logAction };
