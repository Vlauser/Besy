'use strict';

const express = require('express');
const multer = require('multer');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { db, TMP_DIR } = require('../db');
const { storage, keys } = require('../storage');
const { requireAuth, requireVerifiedEmail } = require('../auth');
const { rateLimit, viewerKey, signMedia, SIGNED_MEDIA } = require('../security');
const transcode = require('../transcode');
const { notify, notifySubscribers } = require('../notifications');
const blocks = require('../blocks');
const { RETENTION_BUCKETS, SOURCES, dayKey } = require('./analytics');
const images = require('../images');

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

// Uploads land in a scratch folder first, then move into the storage driver.
const upload = multer({
  storage: multer.diskStorage({
    destination(req, file, cb) { cb(null, TMP_DIR); },
    filename(req, file, cb) {
      const id = req.besyVideoId;
      cb(null, file.fieldname === 'thumbnail'
        ? `${id}.upload.jpg`
        : `${id}.upload${EXT_BY_MIME[file.mimetype] || path.extname(file.originalname) || '.mp4'}`);
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

const uploadLimit = rateLimit({
  name: 'upload',
  limit: Number(process.env.BESY_UPLOAD_RATE_LIMIT) || 20,
  windowMs: 60 * 60 * 1000,
  message: 'Слишком много загрузок за час — попробуйте позже',
  keyFn: (req) => (req.user ? `u${req.user.id}` : req.ip),
});

const commentLimit = rateLimit({
  name: 'comment',
  limit: Number(process.env.BESY_COMMENT_RATE_LIMIT) || 15,
  windowMs: 10 * 60 * 1000,
  message: 'Слишком часто — подождите пару минут',
  keyFn: (req) => (req.user ? `u${req.user.id}` : req.ip),
});

/**
 * Containers are identified by their own bytes, not by the declared MIME type,
 * so a renamed executable cannot slip through.
 */
const MAGIC_CHECKS = [
  { name: 'mp4/mov', test: (b) => b.length > 12 && b.subarray(4, 8).toString('latin1') === 'ftyp' },
  { name: 'webm/mkv', test: (b) => b.length > 4 && b.readUInt32BE(0) === 0x1a45dfa3 },
  { name: 'ogg', test: (b) => b.subarray(0, 4).toString('latin1') === 'OggS' },
  { name: 'avi', test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'AVI ' },
];

async function detectContainer(filePath) {
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(32);
    const { bytesRead } = await handle.read(buffer, 0, 32, 0);
    const head = buffer.subarray(0, bytesRead);
    return MAGIC_CHECKS.find((check) => check.test(head))?.name || null;
  } finally {
    await handle.close();
  }
}

const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

async function isImage(filePath) {
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(8);
    await handle.read(buffer, 0, 8, 0);
    return buffer.subarray(0, 3).equals(JPEG_MAGIC) || buffer.subarray(0, 4).equals(PNG_MAGIC);
  } finally {
    await handle.close();
  }
}

/* ------------------------------------------------------------------ helpers */

function normalizeTags(raw) {
  return String(raw || '')
    .split(/[,\n]/)
    .map((t) => t.trim().replace(/^#/, '').toLowerCase())
    .filter(Boolean)
    .slice(0, 12)
    .join(',');
}

async function cleanupFiles(files) {
  for (const list of Object.values(files || {})) {
    for (const file of list) await fs.promises.rm(file.path, { force: true }).catch(() => {});
  }
}

function shapeVideo(row, viewer, req) {
  if (!row) return null;
  const isOwner = Boolean(viewer && viewer.id === row.user_id);
  // With signed media on, every playback URL carries a short-lived HMAC.
  const suffix = SIGNED_MEDIA && req ? `?token=${signMedia(row.id, viewerKey(req)).token}` : '';
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
    thumbUrl: row.thumb_key ? `/media/thumb/${row.id}` : null,
    streamUrl: `/media/stream/${row.id}${suffix}`,
    hlsUrl: row.hls_master ? `/media/hls/${row.id}/master.m3u8${suffix}` : null,
    ageRestricted: row.age_restricted === 1,
    isShort: row.is_short === 1,
    kind: row.kind,
    publishAt: row.publish_at,
    liveStatus: row.live_status,
    renditions: JSON.parse(row.renditions || '[]'),
    status: row.status,
    progress: row.progress,
    statusError: isOwner ? row.status_error : null,
    blocked: Boolean(row.blocked_at),
    blockedReason: row.blocked_reason || null,
    likes: row.likes ?? 0,
    dislikes: row.dislikes ?? 0,
    comments: row.comment_count ?? 0,
    myReaction: row.my_reaction ?? 0,
    myPosition: row.my_position ?? 0,
    isOwner,
    author: {
      id: row.user_id,
      username: row.username,
      displayName: row.display_name,
      avatar: row.avatar_file ? `/media/avatar/${row.username}` : null,
    },
  };
}

const LIST_SELECT = `
  SELECT v.*, u.username, u.display_name, u.avatar_file,
         (SELECT COUNT(*) FROM reactions r WHERE r.video_id = v.id AND r.value =  1) AS likes,
         (SELECT COUNT(*) FROM reactions r WHERE r.video_id = v.id AND r.value = -1) AS dislikes,
         (SELECT COUNT(*) FROM comments c WHERE c.video_id = v.id)                   AS comment_count
  FROM videos v JOIN users u ON u.id = v.user_id
`;

/* ------------------------------------------------------------------- routes */

// GET /api/videos?sort=new|popular&q=&channel=&limit=&offset=
router.get('/', (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 24, 1), 60);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const q = String(req.query.q || '').trim();
  const channel = String(req.query.channel || '').trim();
  const kind = String(req.query.kind || '').trim(); // '', 'short' or 'video'
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
      where.push('v.blocked_at IS NULL');
      where.push('(v.publish_at IS NULL OR v.publish_at <= ?)');
      params.push(Date.now());
    }
  } else {
    where.push("v.visibility = 'public'");
    where.push('v.blocked_at IS NULL');
    where.push('(v.publish_at IS NULL OR v.publish_at <= ?)');
    params.push(Date.now());
  }

  if (kind === 'short') where.push('v.is_short = 1');
  else if (kind === 'video') where.push('v.is_short = 0');

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

  res.json({ videos: rows.map((r) => shapeVideo(r, req.user, req)), total, limit, offset });
});

// GET /api/videos/:id
router.get('/:id', (req, res) => {
  const row = db.prepare(`${LIST_SELECT} WHERE v.id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Видео не найдено' });

  const isOwner = req.user && req.user.id === row.user_id;
  if (row.visibility === 'private' && !isOwner) {
    return res.status(403).json({ error: 'Это видео приватное' });
  }
  if (row.blocked_at && !isOwner && !req.user?.isAdmin) {
    return res.status(451).json({
      error: `Видео заблокировано модерацией${row.blocked_reason ? `: ${row.blocked_reason}` : ''}`,
    });
  }
  if (row.publish_at && row.publish_at > Date.now() && !isOwner && !req.user?.isAdmin) {
    return res.status(403).json({
      error: 'Публикация запланирована на более позднее время',
      publishAt: row.publish_at,
    });
  }
  // Age-restricted videos require a signed-in viewer, as on other platforms.
  if (row.age_restricted && !req.user) {
    return res.status(403).json({
      error: 'Это видео с возрастным ограничением — войдите в аккаунт, чтобы смотреть',
      ageRestricted: true,
    });
  }

  if (req.user) {
    const reaction = db.prepare('SELECT value FROM reactions WHERE video_id = ? AND user_id = ?')
      .get(row.id, req.user.id);
    row.my_reaction = reaction ? reaction.value : 0;

    // Where this viewer stopped last time. The heartbeat has always written it
    // and the history page has always drawn it as a progress bar, but nothing
    // ever handed it back to the player, so every video restarted from zero.
    const seen = db.prepare('SELECT position FROM watch_history WHERE user_id = ? AND video_id = ?')
      .get(req.user.id, row.id);
    row.my_position = seen ? seen.position : 0;
  }

  const related = db.prepare(`
    ${LIST_SELECT}
    WHERE v.visibility = 'public' AND v.blocked_at IS NULL AND v.id != ?
    ORDER BY (v.user_id = ?) DESC, v.views DESC, v.created_at DESC
    LIMIT 12
  `).all(row.id, row.user_id);

  const captions = db.prepare('SELECT * FROM captions WHERE video_id = ? ORDER BY is_default DESC, label')
    .all(row.id)
    .map((caption) => ({
      id: caption.id,
      lang: caption.lang,
      label: caption.label,
      isDefault: caption.is_default === 1,
      url: `/media/captions/${row.id}/${caption.id}.vtt`,
    }));

  const subscribers = db.prepare('SELECT COUNT(*) AS n FROM subscriptions WHERE channel_id = ?')
    .get(row.user_id).n;
  const subscribed = req.user
    ? Boolean(db.prepare('SELECT 1 FROM subscriptions WHERE channel_id = ? AND subscriber_id = ?')
        .get(row.user_id, req.user.id))
    : false;

  res.json({
    video: { ...shapeVideo(row, req.user, req), captions },
    channel: { subscribers, subscribed },
    related: related.map((r) => shapeVideo(r, req.user, req)),
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
  requireVerifiedEmail,
  uploadLimit,
  assignVideoId,
  upload.fields([{ name: 'video', maxCount: 1 }, { name: 'thumbnail', maxCount: 1 }]),
  async (req, res, next) => {
    const videoFile = req.files?.video?.[0];
    const thumbFile = req.files?.thumbnail?.[0];

    try {
      if (!videoFile) {
        await cleanupFiles(req.files);
        return res.status(400).json({ error: 'Не выбран видеофайл' });
      }

      const title = String(req.body.title || '').trim();
      if (!title || title.length > 140) {
        await cleanupFiles(req.files);
        return res.status(400).json({ error: 'Заголовок: 1–140 символов' });
      }

      const description = String(req.body.description || '').slice(0, 5000);
      const tags = normalizeTags(req.body.tags);
      const visibility = ['public', 'unlisted', 'private'].includes(req.body.visibility)
        ? req.body.visibility
        : 'public';

      const requestedPublishAt = Number(req.body.publishAt) || 0;
      const publishAt = requestedPublishAt > Date.now() ? requestedPublishAt : null;

      const container = await detectContainer(videoFile.path);
      if (!container) {
        await cleanupFiles(req.files);
        return res.status(415).json({ error: 'Файл не похож на видео — проверьте формат' });
      }

      if (thumbFile && !(await isImage(thumbFile.path))) {
        await fs.promises.rm(thumbFile.path, { force: true }).catch(() => {});
        req.files.thumbnail = undefined;
      }

      const id = req.besyVideoId;
      const videoKey = keys.video(id, path.extname(videoFile.filename));
      await storage.putFile(videoKey, videoFile.path);

      let thumbKey = null;
      if (thumbFile && req.files.thumbnail) {
        thumbKey = keys.thumb(id);
        await storage.putFile(thumbKey, thumbFile.path);
      }

      db.prepare(`
        INSERT INTO videos (id, user_id, title, description, tags, visibility,
                            file_key, file_size, mime_type, duration, width, height,
                            thumb_key, status, age_restricted, publish_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, req.user.id, title, description, tags, visibility,
        videoKey, videoFile.size, videoFile.mimetype,
        Number(req.body.duration) || 0,
        Number(req.body.width) || 0,
        Number(req.body.height) || 0,
        thumbKey,
        'processing',
        req.body.ageRestricted === 'true' || req.body.ageRestricted === '1' ? 1 : 0,
        publishAt,
        Date.now(),
      );

      // Falls back to plain progressive playback when ffmpeg is unavailable.
      const queuedForTranscode = await transcode.enqueue(id);
      if (!queuedForTranscode) {
        db.prepare("UPDATE videos SET status = 'ready' WHERE id = ?").run(id);
        // With no transcode step there is nothing else that would scan it.
        transcode.scanForMatches(id);
      }

      if (visibility === 'public' && !publishAt) {
        notifySubscribers({
          channelId: req.user.id,
          type: 'new_video',
          videoId: id,
          body: title,
        });
      }

      const row = db.prepare(`${LIST_SELECT} WHERE v.id = ?`).get(id);
      res.status(201).json({ video: shapeVideo(row, req.user, req) });
    } catch (err) {
      await cleanupFiles(req.files);
      next(err);
    }
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

  const ageRestricted = req.body.ageRestricted === undefined
    ? row.age_restricted
    : (req.body.ageRestricted ? 1 : 0);

  let publishAt = row.publish_at;
  if (req.body.publishAt !== undefined) {
    const requested = Number(req.body.publishAt) || 0;
    publishAt = requested > Date.now() ? requested : null;
  }

  db.prepare(`
    UPDATE videos SET title = ?, description = ?, tags = ?, visibility = ?, age_restricted = ?,
                      publish_at = ?
    WHERE id = ?
  `).run(title, description, tags, visibility, ageRestricted, publishAt, row.id);

  // Going public for the first time is what subscribers should hear about.
  if (visibility === 'public' && !publishAt && (row.visibility !== 'public' || row.publish_at)) {
    notifySubscribers({ channelId: row.user_id, type: 'new_video', videoId: row.id, body: title });
  }

  const updated = db.prepare(`${LIST_SELECT} WHERE v.id = ?`).get(row.id);
  res.json({ video: shapeVideo(updated, req.user, req) });
});

// DELETE /api/videos/:id
/*
 * POST /api/videos/:id/thumbnail  (multipart: image)
 *
 * The cover chosen while uploading was a guess made before the video existed
 * anywhere; this is how it gets corrected afterwards. The picture comes in
 * already cropped by the page — the server only checks that it really is an
 * image and that the person sending it owns the video.
 */
const coverUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: images.MAX_BYTES, files: 1 },
});

const coverLimit = rateLimit({
  name: 'cover',
  limit: Number(process.env.BESY_ARTWORK_RATE_LIMIT) || 30,
  windowMs: 60 * 60 * 1000,
  message: 'Слишком много загрузок обложек за час',
  keyFn: (req) => (req.user ? `u${req.user.id}` : req.ip),
});

router.post('/:id/thumbnail', requireAuth, coverLimit, coverUpload.single('image'), async (req, res, next) => {
  const row = db.prepare('SELECT id, user_id, thumb_key FROM videos WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Видео не найдено' });
  if (row.user_id !== req.user.id) return res.status(403).json({ error: 'Это не ваше видео' });
  if (!req.file) return res.status(400).json({ error: 'Файл не получен' });
  const image = images.identify(req.file.buffer);
  if (!image) return res.status(400).json({ error: 'Нужен файл JPEG, PNG, WebP или GIF' });

  try {
    const thumbKey = keys.thumb(row.id, image.ext);
    await storage.putBuffer(thumbKey, req.file.buffer);
    db.prepare('UPDATE videos SET thumb_key = ? WHERE id = ?').run(thumbKey, row.id);
    // A different format lands on a different key, so the old file would stay.
    if (row.thumb_key && row.thumb_key !== thumbKey) {
      await storage.delete(row.thumb_key).catch(() => {});
    }
    res.status(201).json({ ok: true, thumbUrl: `/media/thumb/${row.id}?v=${Date.now()}` });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requireAuth, async (req, res, next) => {
  const row = db.prepare('SELECT * FROM videos WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Видео не найдено' });
  if (row.user_id !== req.user.id && !req.user.isAdmin) {
    return res.status(403).json({ error: 'Это не ваше видео' });
  }

  try {
    db.prepare('DELETE FROM videos WHERE id = ?').run(row.id);
    // Live streams carry no uploaded file — their playback is HLS segments only.
    if (row.file_key) await storage.delete(row.file_key);
    if (row.thumb_key) await storage.delete(row.thumb_key);
    await storage.deletePrefix(keys.hlsDir(row.id));
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
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

    db.prepare(`
      INSERT INTO video_stats_daily (video_id, day, views) VALUES (?, ?, 1)
      ON CONFLICT(video_id, day) DO UPDATE SET views = views + 1
    `).run(row.id, dayKey(now));

    const source = SOURCES[req.body?.source] ? req.body.source : 'direct';
    db.prepare(`
      INSERT INTO traffic_sources (video_id, source, hits) VALUES (?, ?, 1)
      ON CONFLICT(video_id, source) DO UPDATE SET hits = hits + 1
    `).run(row.id, source);
  }

  const views = db.prepare('SELECT views FROM videos WHERE id = ?').get(row.id).views;
  res.json({ views });
});

const heartbeatLimit = rateLimit({
  name: 'heartbeat',
  limit: Number(process.env.BESY_HEARTBEAT_RATE_LIMIT) || 240,
  windowMs: 10 * 60 * 1000,
  keyFn: (req) => (req.user ? `u${req.user.id}` : req.ip),
});

/**
 * Playback heartbeat: accumulates watch time, feeds the retention curve and
 * keeps the viewer's history position up to date.
 */
router.post('/:id/heartbeat', heartbeatLimit, (req, res) => {
  const row = db.prepare('SELECT id, duration FROM videos WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Видео не найдено' });

  // Trust the client only within the bounds of one heartbeat interval.
  const seconds = Math.min(Math.max(Number(req.body.seconds) || 0, 0), 60);
  const position = Math.max(Number(req.body.position) || 0, 0);
  const duration = Number(req.body.duration) || row.duration || 0;

  if (seconds > 0) {
    db.prepare(`
      INSERT INTO video_stats_daily (video_id, day, watch_seconds) VALUES (?, ?, ?)
      ON CONFLICT(video_id, day) DO UPDATE SET watch_seconds = watch_seconds + excluded.watch_seconds
    `).run(row.id, dayKey(), Math.round(seconds));
  }

  if (duration > 0 && position <= duration + 1) {
    // Retention counts viewers who *reached* a point, so each viewer moves the
    // curve once per bucket — that keeps it monotonically decreasing.
    const bucket = Math.min(RETENTION_BUCKETS - 1, Math.floor((position / duration) * RETENTION_BUCKETS));
    const key = viewerKey(req);
    const progress = db.prepare('SELECT max_bucket FROM retention_progress WHERE video_id = ? AND viewer_key = ?')
      .get(row.id, key);
    const previous = progress ? progress.max_bucket : -1;

    if (bucket > previous) {
      const bump = db.prepare(`
        INSERT INTO retention_buckets (video_id, bucket, hits) VALUES (?, ?, 1)
        ON CONFLICT(video_id, bucket) DO UPDATE SET hits = hits + 1
      `);
      for (let i = previous + 1; i <= bucket; i += 1) bump.run(row.id, i);

      db.prepare(`
        INSERT INTO retention_progress (video_id, viewer_key, max_bucket, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(video_id, viewer_key) DO UPDATE SET max_bucket = excluded.max_bucket,
                                                        updated_at = excluded.updated_at
      `).run(row.id, key, bucket, Date.now());
    }
  }

  if (req.user) {
    db.prepare(`
      INSERT INTO watch_history (user_id, video_id, position, seconds, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id, video_id) DO UPDATE
        SET position = excluded.position,
            seconds = seconds + excluded.seconds,
            updated_at = excluded.updated_at
    `).run(req.user.id, row.id, position, Math.round(seconds), Date.now());
  }

  res.json({ ok: true });
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

const LINK_RE = /https?:\/\/|www\.[a-z0-9-]+\.[a-z]{2,}/gi;
const SPAM_WORDS = /(?:бесплатн[а-я]*\s+крипт|заработок\s+без\s+вложений|подпишись\s+на\s+мой\s+канал\s+взаимно|free\s+v-?bucks|casino\s+bonus|http:\/\/bit\.ly)/i;

/** Cheap heuristics that stop the obvious flood without a moderation queue. */
function spamProblem(body, userId, videoId) {
  const links = (body.match(LINK_RE) || []).length;
  if (links > 2) return 'Слишком много ссылок в комментарии';
  if (SPAM_WORDS.test(body)) return 'Комментарий похож на спам';

  const letters = body.replace(/[^\p{L}]/gu, '');
  const upper = letters.replace(/[^\p{Lu}]/gu, '');
  if (letters.length > 20 && upper.length / letters.length > 0.8) {
    return 'Не пишите весь комментарий заглавными буквами';
  }

  const recent = db.prepare(`
    SELECT body, created_at FROM comments
    WHERE user_id = ? AND created_at > ?
    ORDER BY created_at DESC LIMIT 5
  `).all(userId, Date.now() - 10 * 60 * 1000);

  if (recent.some((row) => row.body.trim() === body.trim())) {
    return 'Такой комментарий вы уже оставляли';
  }
  if (recent.length >= 3 && recent.every((row) => row.body.length === body.length)) {
    return 'Слишком похожие комментарии подряд';
  }

  const onThisVideo = db.prepare(
    'SELECT COUNT(*) AS n FROM comments WHERE user_id = ? AND video_id = ? AND created_at > ?'
  ).get(userId, videoId, Date.now() - 60 * 1000).n;
  if (onThisVideo >= 3) return 'Слишком часто — подождите минуту';

  return null;
}

router.get('/:id/comments', (req, res) => {
  const rows = db.prepare(`
    SELECT c.id, c.body, c.created_at, u.id AS user_id, u.username, u.display_name, u.avatar_file
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

router.post('/:id/comments', requireAuth, requireVerifiedEmail, commentLimit, (req, res) => {
  const video = db.prepare('SELECT id, user_id, blocked_at FROM videos WHERE id = ?').get(req.params.id);
  if (!video) return res.status(404).json({ error: 'Видео не найдено' });
  if (video.blocked_at) return res.status(451).json({ error: 'Видео заблокировано' });

  // Either direction of a block closes the comment box: a channel owner does
  // not have to read this person, and someone who blocked the owner is not
  // kept around to argue under their videos.
  if (blocks.eitherBlocked(video.user_id, req.user.id)) {
    return res.status(403).json({ error: 'Комментарии для вас недоступны на этом канале' });
  }

  const body = String(req.body.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Комментарий пустой' });
  if (body.length > 2000) return res.status(400).json({ error: 'Комментарий длиннее 2000 символов' });

  const spam = spamProblem(body, req.user.id, video.id);
  if (spam) return res.status(429).json({ error: spam });

  const info = db.prepare('INSERT INTO comments (video_id, user_id, body, created_at) VALUES (?, ?, ?, ?)')
    .run(video.id, req.user.id, body, Date.now());

  const owner = db.prepare('SELECT user_id, title FROM videos WHERE id = ?').get(video.id);
  notify({
    userId: owner.user_id,
    type: 'comment',
    actorId: req.user.id,
    videoId: video.id,
    body: body.slice(0, 140),
  });

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
