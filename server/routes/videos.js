'use strict';

const express = require('express');
const multer = require('multer');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { db, VIDEO_DIR, THUMB_DIR } = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();

const MAX_VIDEO_BYTES = Number(process.env.BESY_MAX_UPLOAD_MB || 2048) * 1024 * 1024;
const VIEW_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const ALLOWED_VIDEO_MIME = new Set([
  'video/mp4', 'video/webm', 'video/ogg', 'video/quicktime', 'video/x-matroska',
]);
const EXT_BY_MIME = {
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/ogg': '.ogv',
  'video/quicktime': '.mov',
  'video/x-matroska': '.mkv',
};

const upload = multer({
  storage: multer.diskStorage({
    destination(req, file, cb) {
      cb(null, file.fieldname === 'thumbnail' ? THUMB_DIR : VIDEO_DIR);
    },
    filename(req, file, cb) {
      const id = req.besyVideoId;
      if (file.fieldname === 'thumbnail') {
        cb(null, `${id}.jpg`);
      } else {
        cb(null, `${id}${EXT_BY_MIME[file.mimetype] || path.extname(file.originalname) || '.mp4'}`);
      }
    },
  }),
  limits: { fileSize: MAX_VIDEO_BYTES, files: 2 },
  fileFilter(req, file, cb) {
    if (file.fieldname === 'video') {
      if (!ALLOWED_VIDEO_MIME.has(file.mimetype)) {
        return cb(new Error('Поддерживаются форматы MP4, WebM, OGV, MOV, MKV'));
      }
      return cb(null, true);
    }
    if (file.fieldname === 'thumbnail') {
      return cb(null, file.mimetype === 'image/jpeg' || file.mimetype === 'image/png');
    }
    cb(new Error('Неожиданное поле файла'));
  },
});

/* ------------------------------------------------------------------ helpers */

function normalizeTags(raw) {
  return String(raw || '')
    .split(/[,\n]/)
    .map((t) => t.trim().replace(/^#/, '').toLowerCase())
    .filter(Boolean)
    .slice(0, 12)
    .join(',');
}

function cleanupFiles(files) {
  for (const list of Object.values(files || {})) {
    for (const file of list) fs.rm(file.path, { force: true }, () => {});
  }
}

function shapeVideo(row, viewer) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    tags: row.tags ? row.tags.split(',') : [],
    visibility: row.visibility,
    duration: row.duration,
    width: row.width,
    height: row.height,
    views: row.views,
    createdAt: row.created_at,
    fileSize: row.file_size,
    thumbUrl: row.thumb_file ? `/media/thumb/${row.id}` : null,
    streamUrl: `/media/stream/${row.id}`,
    likes: row.likes ?? 0,
    dislikes: row.dislikes ?? 0,
    comments: row.comment_count ?? 0,
    myReaction: row.my_reaction ?? 0,
    isOwner: Boolean(viewer && viewer.id === row.user_id),
    author: {
      id: row.user_id,
      username: row.username,
      displayName: row.display_name,
    },
  };
}

const LIST_SELECT = `
  SELECT v.*, u.username, u.display_name,
         (SELECT COUNT(*) FROM reactions r WHERE r.video_id = v.id AND r.value =  1) AS likes,
         (SELECT COUNT(*) FROM reactions r WHERE r.video_id = v.id AND r.value = -1) AS dislikes,
         (SELECT COUNT(*) FROM comments c WHERE c.video_id = v.id)                   AS comment_count
  FROM videos v JOIN users u ON u.id = v.user_id
`;

function viewerKey(req) {
  if (req.user) return `u${req.user.id}`;
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const ua = req.get('user-agent') || '';
  return `a${crypto.createHash('sha256').update(ip + ua).digest('hex').slice(0, 24)}`;
}

/* ------------------------------------------------------------------- routes */

// GET /api/videos?sort=new|popular&q=&channel=&limit=&offset=
router.get('/', (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 24, 1), 60);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const q = String(req.query.q || '').trim();
  const channel = String(req.query.channel || '').trim();
  const sort = req.query.sort === 'popular' ? 'v.views DESC, v.created_at DESC' : 'v.created_at DESC';

  const where = [];
  const params = [];

  if (channel) {
    where.push('lower(u.username) = lower(?)');
    params.push(channel);
    // A channel owner sees their unlisted/private videos on their own page.
    if (req.user && req.user.username.toLowerCase() === channel.toLowerCase()) {
      where.push("v.visibility IN ('public','unlisted','private')");
    } else {
      where.push("v.visibility = 'public'");
    }
  } else {
    where.push("v.visibility = 'public'");
  }

  if (q) {
    where.push('(v.title LIKE ? OR v.description LIKE ? OR v.tags LIKE ? OR u.display_name LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }

  const rows = db.prepare(
    `${LIST_SELECT} WHERE ${where.join(' AND ')} ORDER BY ${sort} LIMIT ? OFFSET ?`
  ).all(...params, limit, offset);

  const total = db.prepare(
    `SELECT COUNT(*) AS n FROM videos v JOIN users u ON u.id = v.user_id WHERE ${where.join(' AND ')}`
  ).get(...params).n;

  res.json({ videos: rows.map((r) => shapeVideo(r, req.user)), total, limit, offset });
});

// GET /api/videos/:id
router.get('/:id', (req, res) => {
  const row = db.prepare(`${LIST_SELECT} WHERE v.id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Видео не найдено' });

  const isOwner = req.user && req.user.id === row.user_id;
  if (row.visibility === 'private' && !isOwner) {
    return res.status(403).json({ error: 'Это видео приватное' });
  }

  if (req.user) {
    const reaction = db.prepare('SELECT value FROM reactions WHERE video_id = ? AND user_id = ?')
      .get(row.id, req.user.id);
    row.my_reaction = reaction ? reaction.value : 0;
  }

  const related = db.prepare(`
    ${LIST_SELECT}
    WHERE v.visibility = 'public' AND v.id != ?
    ORDER BY (v.user_id = ?) DESC, v.views DESC, v.created_at DESC
    LIMIT 12
  `).all(row.id, row.user_id);

  const subscribers = db.prepare('SELECT COUNT(*) AS n FROM subscriptions WHERE channel_id = ?')
    .get(row.user_id).n;
  const subscribed = req.user
    ? Boolean(db.prepare('SELECT 1 FROM subscriptions WHERE channel_id = ? AND subscriber_id = ?')
        .get(row.user_id, req.user.id))
    : false;

  res.json({
    video: shapeVideo(row, req.user),
    channel: { subscribers, subscribed },
    related: related.map((r) => shapeVideo(r, req.user)),
  });
});

// POST /api/videos  (multipart: video, thumbnail?)
/** Assigns the video id before multer touches the stream, so both files share it. */
function assignVideoId(req, res, next) {
  req.besyVideoId = crypto.randomBytes(9).toString('base64url');
  next();
}

router.post(
  '/',
  requireAuth,
  assignVideoId,
  upload.fields([{ name: 'video', maxCount: 1 }, { name: 'thumbnail', maxCount: 1 }]),
  (req, res) => {
    const videoFile = req.files?.video?.[0];
    const thumbFile = req.files?.thumbnail?.[0];

    if (!videoFile) {
      cleanupFiles(req.files);
      return res.status(400).json({ error: 'Не выбран видеофайл' });
    }

    const title = String(req.body.title || '').trim();
    if (!title || title.length > 140) {
      cleanupFiles(req.files);
      return res.status(400).json({ error: 'Заголовок: 1–140 символов' });
    }

    const description = String(req.body.description || '').slice(0, 5000);
    const tags = normalizeTags(req.body.tags);
    const visibility = ['public', 'unlisted', 'private'].includes(req.body.visibility)
      ? req.body.visibility
      : 'public';

    const id = req.besyVideoId;
    db.prepare(`
      INSERT INTO videos (id, user_id, title, description, tags, visibility,
                          file_name, file_size, mime_type, duration, width, height,
                          thumb_file, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, req.user.id, title, description, tags, visibility,
      videoFile.filename, videoFile.size, videoFile.mimetype,
      Number(req.body.duration) || 0,
      Number(req.body.width) || 0,
      Number(req.body.height) || 0,
      thumbFile ? thumbFile.filename : null,
      Date.now(),
    );

    const row = db.prepare(`${LIST_SELECT} WHERE v.id = ?`).get(id);
    res.status(201).json({ video: shapeVideo(row, req.user) });
  }
);

// PATCH /api/videos/:id
router.patch('/:id', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM videos WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Видео не найдено' });
  if (row.user_id !== req.user.id) return res.status(403).json({ error: 'Это не ваше видео' });

  const title = String(req.body.title ?? row.title).trim();
  if (!title || title.length > 140) return res.status(400).json({ error: 'Заголовок: 1–140 символов' });

  const description = String(req.body.description ?? row.description).slice(0, 5000);
  const tags = req.body.tags === undefined ? row.tags : normalizeTags(req.body.tags);
  const visibility = ['public', 'unlisted', 'private'].includes(req.body.visibility)
    ? req.body.visibility
    : row.visibility;

  db.prepare('UPDATE videos SET title = ?, description = ?, tags = ?, visibility = ? WHERE id = ?')
    .run(title, description, tags, visibility, row.id);

  const updated = db.prepare(`${LIST_SELECT} WHERE v.id = ?`).get(row.id);
  res.json({ video: shapeVideo(updated, req.user) });
});

// DELETE /api/videos/:id
router.delete('/:id', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM videos WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Видео не найдено' });
  if (row.user_id !== req.user.id) return res.status(403).json({ error: 'Это не ваше видео' });

  db.prepare('DELETE FROM videos WHERE id = ?').run(row.id);
  fs.rm(path.join(VIDEO_DIR, row.file_name), { force: true }, () => {});
  if (row.thumb_file) fs.rm(path.join(THUMB_DIR, row.thumb_file), { force: true }, () => {});

  res.json({ ok: true });
});

// POST /api/videos/:id/view
router.post('/:id/view', (req, res) => {
  const row = db.prepare('SELECT id FROM videos WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Видео не найдено' });

  const key = viewerKey(req);
  const now = Date.now();
  const prev = db.prepare('SELECT viewed_at FROM video_views WHERE video_id = ? AND viewer_key = ?')
    .get(row.id, key);

  if (!prev || now - prev.viewed_at > VIEW_COOLDOWN_MS) {
    db.prepare(`
      INSERT INTO video_views (video_id, viewer_key, viewed_at) VALUES (?, ?, ?)
      ON CONFLICT(video_id, viewer_key) DO UPDATE SET viewed_at = excluded.viewed_at
    `).run(row.id, key, now);
    db.prepare('UPDATE videos SET views = views + 1 WHERE id = ?').run(row.id);
  }

  const views = db.prepare('SELECT views FROM videos WHERE id = ?').get(row.id).views;
  res.json({ views });
});

// POST /api/videos/:id/reaction  { value: 1 | -1 | 0 }
router.post('/:id/reaction', requireAuth, (req, res) => {
  const row = db.prepare('SELECT id FROM videos WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Видео не найдено' });

  const value = Number(req.body.value);
  if (![1, -1, 0].includes(value)) return res.status(400).json({ error: 'Некорректная реакция' });

  if (value === 0) {
    db.prepare('DELETE FROM reactions WHERE video_id = ? AND user_id = ?').run(row.id, req.user.id);
  } else {
    db.prepare(`
      INSERT INTO reactions (video_id, user_id, value, created_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(video_id, user_id) DO UPDATE SET value = excluded.value
    `).run(row.id, req.user.id, value, Date.now());
  }

  const counts = db.prepare(`
    SELECT SUM(value =  1) AS likes, SUM(value = -1) AS dislikes
    FROM reactions WHERE video_id = ?
  `).get(row.id);

  res.json({ likes: counts.likes || 0, dislikes: counts.dislikes || 0, myReaction: value });
});

/* ----------------------------------------------------------------- comments */

router.get('/:id/comments', (req, res) => {
  const rows = db.prepare(`
    SELECT c.id, c.body, c.created_at, u.id AS user_id, u.username, u.display_name
    FROM comments c JOIN users u ON u.id = c.user_id
    WHERE c.video_id = ?
    ORDER BY c.created_at DESC
    LIMIT 200
  `).all(req.params.id);

  res.json({
    comments: rows.map((r) => ({
      id: r.id,
      body: r.body,
      createdAt: r.created_at,
      isOwner: Boolean(req.user && req.user.id === r.user_id),
      author: { id: r.user_id, username: r.username, displayName: r.display_name },
    })),
  });
});

router.post('/:id/comments', requireAuth, (req, res) => {
  const video = db.prepare('SELECT id FROM videos WHERE id = ?').get(req.params.id);
  if (!video) return res.status(404).json({ error: 'Видео не найдено' });

  const body = String(req.body.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Комментарий пустой' });
  if (body.length > 2000) return res.status(400).json({ error: 'Комментарий длиннее 2000 символов' });

  const info = db.prepare('INSERT INTO comments (video_id, user_id, body, created_at) VALUES (?, ?, ?, ?)')
    .run(video.id, req.user.id, body, Date.now());

  res.status(201).json({
    comment: {
      id: Number(info.lastInsertRowid),
      body,
      createdAt: Date.now(),
      isOwner: true,
      author: { id: req.user.id, username: req.user.username, displayName: req.user.displayName },
    },
  });
});

router.delete('/:videoId/comments/:commentId', requireAuth, (req, res) => {
  const comment = db.prepare('SELECT c.*, v.user_id AS video_owner FROM comments c JOIN videos v ON v.id = c.video_id WHERE c.id = ? AND c.video_id = ?')
    .get(Number(req.params.commentId), req.params.videoId);
  if (!comment) return res.status(404).json({ error: 'Комментарий не найден' });
  if (comment.user_id !== req.user.id && comment.video_owner !== req.user.id) {
    return res.status(403).json({ error: 'Нельзя удалить чужой комментарий' });
  }

  db.prepare('DELETE FROM comments WHERE id = ?').run(comment.id);
  res.json({ ok: true });
});

module.exports = router;
