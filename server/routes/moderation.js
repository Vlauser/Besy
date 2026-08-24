'use strict';

const express = require('express');

const { db } = require('../db');
const { requireAuth, requireAdmin } = require('../auth');
const { rateLimit } = require('../security');
const { logAction } = require('../audit');
const { storage, keys } = require('../storage');
const { notify } = require('../notifications');

const router = express.Router();

const STRIKE_TTL_MS = 90 * 24 * 60 * 60 * 1000; // strikes expire after 90 days
const STRIKES_TO_BAN = 3;

const REPORT_REASONS = {
  spam: 'Спам или мошенничество',
  hate: 'Разжигание ненависти',
  violence: 'Насилие или жестокость',
  sexual: 'Материалы сексуального характера',
  harassment: 'Травля и угрозы',
  misinformation: 'Дезинформация',
  copyright: 'Нарушение авторских прав',
  other: 'Другое',
};

const reportLimit = rateLimit({
  name: 'report',
  limit: 10,
  windowMs: 60 * 60 * 1000,
  message: 'Слишком много жалоб за час',
  keyFn: (req) => (req.user ? `u${req.user.id}` : req.ip),
});


/** Counts only strikes that have not expired yet. */
function activeStrikes(userId) {
  return db.prepare('SELECT COUNT(*) AS n FROM strikes WHERE user_id = ? AND expires_at > ?')
    .get(userId, Date.now()).n;
}

function syncStrikeState(userId, actorId) {
  const count = activeStrikes(userId);
  db.prepare('UPDATE users SET strikes = ? WHERE id = ?').run(count, userId);

  if (count >= STRIKES_TO_BAN) {
    const user = db.prepare('SELECT banned_at FROM users WHERE id = ?').get(userId);
    if (!user.banned_at) {
      db.prepare('UPDATE users SET banned_at = ?, ban_reason = ? WHERE id = ?')
        .run(Date.now(), `Автоблокировка: ${count} предупреждения`, userId);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
      logAction(actorId, 'auto_ban', 'user', userId, `strikes=${count}`);
    }
  }
  return count;
}

/* ------------------------------------------------------------------ reports */

router.get('/reasons', (req, res) => {
  res.json({ reasons: Object.entries(REPORT_REASONS).map(([id, label]) => ({ id, label })) });
});

// Anyone signed in can report a video, a comment, or a whole channel. Channel
// reports exist because harassment is often a pattern across many items rather
// than any single one a moderator could be pointed at.
const REPORT_TARGETS = new Set(['video', 'comment', 'user']);

router.post('/reports', requireAuth, reportLimit, (req, res) => {
  const targetType = REPORT_TARGETS.has(req.body.targetType) ? req.body.targetType : 'video';
  const reason = REPORT_REASONS[req.body.reason] ? req.body.reason : 'other';
  const details = String(req.body.details || '').slice(0, 1000);

  let videoId = null;
  let commentId = null;
  let reportedUserId = null;

  if (targetType === 'comment') {
    const comment = db.prepare('SELECT id, video_id FROM comments WHERE id = ?')
      .get(Number(req.body.commentId));
    if (!comment) return res.status(404).json({ error: 'Комментарий не найден' });
    commentId = comment.id;
    videoId = comment.video_id;
  } else if (targetType === 'user') {
    const user = db.prepare('SELECT id FROM users WHERE lower(username) = lower(?)')
      .get(String(req.body.username || ''));
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
    if (user.id === req.user.id) return res.status(400).json({ error: 'Нельзя пожаловаться на себя' });
    reportedUserId = user.id;
  } else {
    const video = db.prepare('SELECT id FROM videos WHERE id = ?').get(String(req.body.videoId || ''));
    if (!video) return res.status(404).json({ error: 'Видео не найдено' });
    videoId = video.id;
  }

  const duplicate = db.prepare(`
    SELECT 1 FROM reports
    WHERE reporter_id = ? AND status = 'open' AND target_type = ?
      AND video_id IS ? AND comment_id IS ? AND reported_user_id IS ?
  `).get(req.user.id, targetType, videoId, commentId, reportedUserId);
  if (duplicate) return res.status(409).json({ error: 'Вы уже отправляли жалобу на это' });

  db.prepare(`
    INSERT INTO reports (target_type, video_id, comment_id, reported_user_id, reporter_id, reason, details, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(targetType, videoId, commentId, reportedUserId, req.user.id, reason, details, Date.now());

  res.status(201).json({ ok: true });
});

router.get('/reports', requireAdmin, (req, res) => {
  const status = ['open', 'resolved', 'dismissed'].includes(req.query.status) ? req.query.status : 'open';
  const rows = db.prepare(`
    SELECT r.*, v.title AS video_title, v.user_id AS video_owner, u.username AS reporter,
           c.body AS comment_body, cu.username AS comment_author,
           ru.username AS reported_user
    FROM reports r
    LEFT JOIN videos v ON v.id = r.video_id
    LEFT JOIN users u ON u.id = r.reporter_id
    LEFT JOIN comments c ON c.id = r.comment_id
    LEFT JOIN users cu ON cu.id = c.user_id
    LEFT JOIN users ru ON ru.id = r.reported_user_id
    WHERE r.status = ?
    ORDER BY r.created_at DESC
    LIMIT 100
  `).all(status);

  res.json({
    reports: rows.map((row) => ({
      id: row.id,
      targetType: row.target_type,
      videoId: row.video_id,
      videoTitle: row.video_title,
      commentId: row.comment_id,
      commentBody: row.comment_body,
      commentAuthor: row.comment_author,
      reporter: row.reporter,
      reason: row.reason,
      reasonLabel: REPORT_REASONS[row.reason] || row.reason,
      details: row.details,
      status: row.status,
      createdAt: row.created_at,
    })),
  });
});

router.post('/reports/:id/resolve', requireAdmin, (req, res) => {
  const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(Number(req.params.id));
  if (!report) return res.status(404).json({ error: 'Жалоба не найдена' });

  const status = req.body.status === 'dismissed' ? 'dismissed' : 'resolved';
  db.prepare('UPDATE reports SET status = ?, resolution = ?, handled_by = ?, handled_at = ? WHERE id = ?')
    .run(status, String(req.body.resolution || '').slice(0, 500), req.user.id, Date.now(), report.id);

  logAction(req.user.id, `report_${status}`, 'report', report.id, report.reason);
  res.json({ ok: true });
});

/* ------------------------------------------------------------------- videos */

router.post('/videos/:id/block', requireAdmin, (req, res) => {
  const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(req.params.id);
  if (!video) return res.status(404).json({ error: 'Видео не найдено' });

  const reason = String(req.body.reason || 'Нарушение правил').slice(0, 300);
  db.prepare('UPDATE videos SET blocked_at = ?, blocked_reason = ? WHERE id = ?')
    .run(Date.now(), reason, video.id);
  logAction(req.user.id, 'block_video', 'video', video.id, reason);
  notify({ userId: video.user_id, type: 'video_blocked', videoId: video.id, body: reason });

  if (req.body.strike) {
    db.prepare(`
      INSERT INTO strikes (user_id, video_id, reason, note, issued_by, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(video.user_id, video.id, reason, String(req.body.note || '').slice(0, 500),
      req.user.id, Date.now() + STRIKE_TTL_MS, Date.now());
    logAction(req.user.id, 'strike', 'user', video.user_id, reason);
    notify({ userId: video.user_id, type: 'strike', videoId: video.id, body: reason });
    syncStrikeState(video.user_id, req.user.id);
  }

  res.json({ ok: true, strikes: activeStrikes(video.user_id) });
});

router.post('/videos/:id/unblock', requireAdmin, (req, res) => {
  const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(req.params.id);
  if (!video) return res.status(404).json({ error: 'Видео не найдено' });

  db.prepare('UPDATE videos SET blocked_at = NULL, blocked_reason = NULL WHERE id = ?').run(video.id);
  logAction(req.user.id, 'unblock_video', 'video', video.id);
  res.json({ ok: true });
});

router.post('/videos/:id/age-restrict', requireAdmin, (req, res) => {
  const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(req.params.id);
  if (!video) return res.status(404).json({ error: 'Видео не найдено' });

  const value = req.body.restricted === false ? 0 : 1;
  db.prepare('UPDATE videos SET age_restricted = ? WHERE id = ?').run(value, video.id);
  logAction(req.user.id, value ? 'age_restrict' : 'age_unrestrict', 'video', video.id);
  res.json({ ok: true, ageRestricted: Boolean(value) });
});

router.delete('/videos/:id', requireAdmin, async (req, res, next) => {
  const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(req.params.id);
  if (!video) return res.status(404).json({ error: 'Видео не найдено' });

  try {
    db.prepare('DELETE FROM videos WHERE id = ?').run(video.id);
    await storage.delete(video.file_key);
    if (video.thumb_key) await storage.delete(video.thumb_key);
    await storage.deletePrefix(keys.hlsDir(video.id));
    logAction(req.user.id, 'delete_video', 'video', video.id, String(req.body.reason || ''));
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/* ----------------------------------------------------------------- comments */

router.delete('/comments/:id', requireAdmin, (req, res) => {
  const comment = db.prepare('SELECT * FROM comments WHERE id = ?').get(Number(req.params.id));
  if (!comment) return res.status(404).json({ error: 'Комментарий не найден' });

  db.prepare('DELETE FROM comments WHERE id = ?').run(comment.id);
  logAction(req.user.id, 'delete_comment', 'comment', comment.id);
  res.json({ ok: true });
});

/* -------------------------------------------------------------------- users */

router.post('/users/:username/ban', requireAdmin, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE lower(username) = lower(?)').get(req.params.username);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  if (user.is_admin) return res.status(403).json({ error: 'Нельзя заблокировать модератора' });

  const reason = String(req.body.reason || 'Нарушение правил').slice(0, 300);
  db.prepare('UPDATE users SET banned_at = ?, ban_reason = ? WHERE id = ?')
    .run(Date.now(), reason, user.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
  logAction(req.user.id, 'ban_user', 'user', user.id, reason);

  res.json({ ok: true });
});

router.post('/users/:username/unban', requireAdmin, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE lower(username) = lower(?)').get(req.params.username);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

  db.prepare('UPDATE users SET banned_at = NULL, ban_reason = NULL WHERE id = ?').run(user.id);
  // Unbanning also clears the strikes that triggered the automatic ban.
  db.prepare('DELETE FROM strikes WHERE user_id = ?').run(user.id);
  db.prepare('UPDATE users SET strikes = 0 WHERE id = ?').run(user.id);
  logAction(req.user.id, 'unban_user', 'user', user.id);

  res.json({ ok: true });
});

router.get('/users/:username/strikes', requireAuth, (req, res) => {
  const user = db.prepare('SELECT id, username FROM users WHERE lower(username) = lower(?)')
    .get(req.params.username);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  if (user.id !== req.user.id && !req.user.isAdmin) {
    return res.status(403).json({ error: 'Доступно только владельцу канала и модераторам' });
  }

  const rows = db.prepare(`
    SELECT s.*, v.title AS video_title FROM strikes s
    LEFT JOIN videos v ON v.id = s.video_id
    WHERE s.user_id = ? ORDER BY s.created_at DESC
  `).all(user.id);

  res.json({
    active: activeStrikes(user.id),
    limit: STRIKES_TO_BAN,
    strikes: rows.map((row) => ({
      id: row.id,
      reason: row.reason,
      note: row.note,
      videoId: row.video_id,
      videoTitle: row.video_title,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      expired: row.expires_at <= Date.now(),
    })),
  });
});

/* --------------------------------------------------------------- copyright */

router.post('/copyright', requireAuth, reportLimit, (req, res) => {
  const video = db.prepare('SELECT id FROM videos WHERE id = ?').get(String(req.body.videoId || ''));
  if (!video) return res.status(404).json({ error: 'Видео не найдено' });

  const work = String(req.body.work || '').trim();
  const statement = String(req.body.statement || '').trim();
  const claimantName = String(req.body.claimantName || '').trim();
  const claimantEmail = String(req.body.claimantEmail || '').trim();

  if (!work || !statement || !claimantName || !claimantEmail) {
    return res.status(400).json({ error: 'Заполните все поля заявления' });
  }
  if (!req.body.confirmed) {
    return res.status(400).json({ error: 'Подтвердите достоверность заявления' });
  }

  db.prepare(`
    INSERT INTO copyright_claims
      (video_id, claimant_id, claimant_name, claimant_email, work, statement, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(video.id, req.user.id, claimantName.slice(0, 200), claimantEmail.slice(0, 200),
    work.slice(0, 500), statement.slice(0, 2000), Date.now());

  res.status(201).json({ ok: true });
});

router.get('/copyright', requireAdmin, (req, res) => {
  const status = ['open', 'accepted', 'rejected'].includes(req.query.status) ? req.query.status : 'open';
  const rows = db.prepare(`
    SELECT c.*, v.title AS video_title, v.user_id AS video_owner
    FROM copyright_claims c LEFT JOIN videos v ON v.id = c.video_id
    WHERE c.status = ? ORDER BY c.created_at DESC LIMIT 100
  `).all(status);

  res.json({
    claims: rows.map((row) => ({
      id: row.id,
      videoId: row.video_id,
      videoTitle: row.video_title,
      claimantName: row.claimant_name,
      claimantEmail: row.claimant_email,
      work: row.work,
      statement: row.statement,
      status: row.status,
      createdAt: row.created_at,
    })),
  });
});

router.post('/copyright/:id/resolve', requireAdmin, (req, res) => {
  const claim = db.prepare('SELECT * FROM copyright_claims WHERE id = ?').get(Number(req.params.id));
  if (!claim) return res.status(404).json({ error: 'Заявление не найдено' });

  const accepted = req.body.status === 'accepted';
  db.prepare(`
    UPDATE copyright_claims SET status = ?, resolution = ?, handled_by = ?, handled_at = ?
    WHERE id = ?
  `).run(accepted ? 'accepted' : 'rejected', String(req.body.resolution || '').slice(0, 500),
    req.user.id, Date.now(), claim.id);

  if (accepted) {
    const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(claim.video_id);
    if (video) {
      db.prepare('UPDATE videos SET blocked_at = ?, blocked_reason = ? WHERE id = ?')
        .run(Date.now(), 'Заявление о нарушении авторских прав', video.id);
      db.prepare(`
        INSERT INTO strikes (user_id, video_id, reason, note, issued_by, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(video.user_id, video.id, 'Нарушение авторских прав', claim.work,
        req.user.id, Date.now() + STRIKE_TTL_MS, Date.now());
      syncStrikeState(video.user_id, req.user.id);
    }
  }

  logAction(req.user.id, `copyright_${accepted ? 'accepted' : 'rejected'}`, 'claim', claim.id);
  res.json({ ok: true });
});

/* --------------------------------------------------------------- audit log */

router.get('/log', requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT l.*, u.username AS actor FROM moderation_log l
    LEFT JOIN users u ON u.id = l.actor_id
    ORDER BY l.created_at DESC LIMIT 200
  `).all();

  res.json({
    entries: rows.map((row) => ({
      id: row.id,
      actor: row.actor || 'система',
      action: row.action,
      targetType: row.target_type,
      targetId: row.target_id,
      details: row.details,
      createdAt: row.created_at,
    })),
  });
});

router.get('/stats', requireAdmin, (req, res) => {
  res.json({
    openReports: db.prepare("SELECT COUNT(*) AS n FROM reports WHERE status = 'open'").get().n,
    openClaims: db.prepare("SELECT COUNT(*) AS n FROM copyright_claims WHERE status = 'open'").get().n,
    blockedVideos: db.prepare('SELECT COUNT(*) AS n FROM videos WHERE blocked_at IS NOT NULL').get().n,
    bannedUsers: db.prepare('SELECT COUNT(*) AS n FROM users WHERE banned_at IS NOT NULL').get().n,
    users: db.prepare('SELECT COUNT(*) AS n FROM users').get().n,
    videos: db.prepare('SELECT COUNT(*) AS n FROM videos').get().n,
  });
});

module.exports = router;
