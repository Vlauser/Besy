'use strict';

const express = require('express');

const { db } = require('../db');
const { requireAuth, requireAdmin, requireVerifiedEmail } = require('../auth');
const { rateLimit } = require('../security');
const matching = require('../matching');

const router = express.Router();

const registerLimit = rateLimit({
  name: 'reference',
  limit: Number(process.env.BESY_REFERENCE_RATE_LIMIT) || 20,
  windowMs: 60 * 60 * 1000,
  message: 'Слишком много работ за час',
  keyFn: (req) => (req.user ? `u${req.user.id}` : req.ip),
});

function shapeWork(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    policy: row.policy,
    policyLabel: matching.POLICIES[row.policy] || row.policy,
    duration: row.duration,
    videoId: row.video_id,
    active: row.active === 1,
    matches: row.match_count ?? 0,
    createdAt: row.created_at,
  };
}

function shapeMatch(row) {
  return {
    id: row.id,
    videoId: row.video_id,
    videoTitle: row.video_title,
    workId: row.work_id,
    workTitle: row.work_title,
    owner: row.owner_username,
    uploader: row.uploader_username,
    kind: row.kind,
    kindLabel: row.kind === 'audio' ? 'Аудиодорожка' : 'Видеоряд',
    secondsMatched: row.seconds_matched,
    score: row.score,
    policy: row.policy,
    status: row.status,
    disputeNote: row.dispute_note,
    resolution: row.resolution,
    createdAt: row.created_at,
  };
}

const MATCH_SELECT = `
  SELECT m.*, v.title AS video_title, v.user_id AS uploader_id,
         w.title AS work_title, w.owner_id,
         uo.username AS owner_username, uu.username AS uploader_username
  FROM content_matches m
  JOIN videos v ON v.id = m.video_id
  JOIN reference_works w ON w.id = m.work_id
  LEFT JOIN users uo ON uo.id = w.owner_id
  LEFT JOIN users uu ON uu.id = v.user_id
`;

router.get('/policies', (req, res) => {
  res.json({
    enabled: matching.ENABLED,
    policies: Object.entries(matching.POLICIES).map(([id, label]) => ({ id, label })),
  });
});

/* ------------------------------------------------------- reference works */

router.get('/works', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT w.*, (SELECT COUNT(*) FROM content_matches m WHERE m.work_id = w.id) AS match_count
    FROM reference_works w WHERE w.owner_id = ? ORDER BY w.created_at DESC
  `).all(req.user.id);

  res.json({ works: rows.map(shapeWork) });
});

// Registers one of your own videos as a reference work.
router.post('/works', requireAuth, requireVerifiedEmail, registerLimit, async (req, res, next) => {
  if (!matching.ENABLED) return res.status(503).json({ error: 'Сопоставление выключено на этом сервере' });

  const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(String(req.body.videoId || ''));
  if (!video) return res.status(404).json({ error: 'Видео не найдено' });
  if (video.user_id !== req.user.id) {
    return res.status(403).json({ error: 'Заявить можно только своё видео' });
  }
  if (video.kind === 'live') {
    return res.status(400).json({ error: 'Эфир нельзя использовать как эталон' });
  }

  const existing = db.prepare('SELECT id FROM reference_works WHERE video_id = ? AND owner_id = ?')
    .get(video.id, req.user.id);
  if (existing) return res.status(409).json({ error: 'Это видео уже заявлено как эталон' });

  const title = String(req.body.title || video.title).trim().slice(0, 140);
  if (!title) return res.status(400).json({ error: 'Нужно название работы' });

  try {
    const work = await matching.registerWork({
      ownerId: req.user.id,
      video,
      title,
      description: String(req.body.description || '').slice(0, 1000),
      policy: req.body.policy,
    });
    res.status(201).json({ work: shapeWork({ ...work, match_count: 0 }) });
  } catch (err) {
    next(err);
  }
});

router.patch('/works/:id', requireAuth, (req, res) => {
  const work = db.prepare('SELECT * FROM reference_works WHERE id = ?').get(req.params.id);
  if (!work) return res.status(404).json({ error: 'Работа не найдена' });
  if (work.owner_id !== req.user.id) return res.status(403).json({ error: 'Это не ваша работа' });

  const policy = matching.POLICIES[req.body.policy] ? req.body.policy : work.policy;
  const active = req.body.active === undefined ? work.active : (req.body.active ? 1 : 0);
  const title = String(req.body.title ?? work.title).trim().slice(0, 140) || work.title;

  db.prepare('UPDATE reference_works SET policy = ?, active = ?, title = ? WHERE id = ?')
    .run(policy, active, title, work.id);

  const updated = db.prepare(`
    SELECT w.*, (SELECT COUNT(*) FROM content_matches m WHERE m.work_id = w.id) AS match_count
    FROM reference_works w WHERE w.id = ?
  `).get(work.id);
  res.json({ work: shapeWork(updated) });
});

router.delete('/works/:id', requireAuth, (req, res) => {
  const work = db.prepare('SELECT * FROM reference_works WHERE id = ?').get(req.params.id);
  if (!work) return res.status(404).json({ error: 'Работа не найдена' });
  if (work.owner_id !== req.user.id) return res.status(403).json({ error: 'Это не ваша работа' });

  db.prepare('DELETE FROM reference_works WHERE id = ?').run(work.id);
  res.json({ ok: true });
});

/* -------------------------------------------------------------- matches */

// Claims against the current user's videos.
router.get('/claims', requireAuth, (req, res) => {
  const rows = db.prepare(`${MATCH_SELECT} WHERE v.user_id = ? ORDER BY m.created_at DESC LIMIT 100`)
    .all(req.user.id);
  res.json({ claims: rows.map(shapeMatch) });
});

// Matches found against the current user's registered works.
router.get('/detections', requireAuth, (req, res) => {
  const rows = db.prepare(`${MATCH_SELECT} WHERE w.owner_id = ? ORDER BY m.created_at DESC LIMIT 100`)
    .all(req.user.id);
  res.json({ detections: rows.map(shapeMatch) });
});

router.get('/video/:id', (req, res) => {
  const video = db.prepare('SELECT id, user_id FROM videos WHERE id = ?').get(req.params.id);
  if (!video) return res.status(404).json({ error: 'Видео не найдено' });

  const rows = db.prepare(`${MATCH_SELECT} WHERE m.video_id = ? AND m.status IN ('active','disputed','upheld')`)
    .all(video.id);

  // Viewers see that a claim exists; details stay with the people involved.
  const isInsider = req.user && (req.user.id === video.user_id || req.user.isAdmin
    || rows.some((row) => row.owner_id === req.user.id));

  res.json({
    claims: rows.map((row) => (isInsider ? shapeMatch(row) : {
      id: row.id,
      workTitle: row.work_title,
      owner: row.owner_username,
      kindLabel: row.kind === 'audio' ? 'Аудиодорожка' : 'Видеоряд',
      status: row.status,
    })),
  });
});

router.post('/claims/:id/dispute', requireAuth, (req, res) => {
  const row = db.prepare(`${MATCH_SELECT} WHERE m.id = ?`).get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Заявка не найдена' });
  if (row.uploader_id !== req.user.id) return res.status(403).json({ error: 'Это не ваше видео' });
  if (row.status !== 'active') return res.status(409).json({ error: 'Заявка уже рассматривается или закрыта' });

  const note = String(req.body.note || '').trim().slice(0, 1000);
  if (!note) return res.status(400).json({ error: 'Опишите, почему заявка неверна' });

  db.prepare("UPDATE content_matches SET status = 'disputed', dispute_note = ? WHERE id = ?")
    .run(note, row.id);

  res.json({ ok: true });
});

// A rights holder can withdraw their own claim without involving moderators.
router.post('/claims/:id/release', requireAuth, (req, res) => {
  const row = db.prepare(`${MATCH_SELECT} WHERE m.id = ?`).get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Заявка не найдена' });
  if (row.owner_id !== req.user.id && !req.user.isAdmin) {
    return res.status(403).json({ error: 'Снять заявку может правообладатель или модератор' });
  }

  releaseClaim(row, req.user.id, String(req.body.resolution || 'Заявка отозвана'));
  res.json({ ok: true });
});

function releaseClaim(row, actorId, resolution) {
  db.prepare(`
    UPDATE content_matches SET status = 'released', resolution = ?, resolved_by = ?, resolved_at = ?
    WHERE id = ?
  `).run(resolution.slice(0, 500), actorId, Date.now(), row.id);

  // Unblock only if nothing else is holding the video down.
  const stillBlocking = db.prepare(`
    SELECT COUNT(*) AS n FROM content_matches
    WHERE video_id = ? AND id != ? AND policy = 'block' AND status IN ('active','disputed','upheld')
  `).get(row.video_id, row.id).n;

  if (!stillBlocking && row.policy === 'block') {
    db.prepare('UPDATE videos SET blocked_at = NULL, blocked_reason = NULL WHERE id = ?')
      .run(row.video_id);
  }
}

/* ----------------------------------------------------------- moderation */

router.get('/disputes', requireAdmin, (req, res) => {
  const rows = db.prepare(`${MATCH_SELECT} WHERE m.status = 'disputed' ORDER BY m.created_at DESC LIMIT 100`)
    .all();
  res.json({ disputes: rows.map(shapeMatch) });
});

router.post('/disputes/:id/resolve', requireAdmin, (req, res) => {
  const row = db.prepare(`${MATCH_SELECT} WHERE m.id = ?`).get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Заявка не найдена' });

  const resolution = String(req.body.resolution || '').slice(0, 500);

  if (req.body.decision === 'uphold') {
    db.prepare(`
      UPDATE content_matches SET status = 'upheld', resolution = ?, resolved_by = ?, resolved_at = ?
      WHERE id = ?
    `).run(resolution, req.user.id, Date.now(), row.id);
  } else {
    releaseClaim(row, req.user.id, resolution || 'Заявка отклонена модератором');
  }

  res.json({ ok: true });
});

/* --------------------------------------------------------------- rescan */

router.post('/rescan/:videoId', requireAuth, async (req, res, next) => {
  const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(req.params.videoId);
  if (!video) return res.status(404).json({ error: 'Видео не найдено' });
  if (video.user_id !== req.user.id && !req.user.isAdmin) {
    return res.status(403).json({ error: 'Это не ваше видео' });
  }

  try {
    const created = await matching.scanVideo(video.id);
    res.json({ ok: true, created: created.length });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
