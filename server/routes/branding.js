'use strict';

/**
 * Channel artwork: the avatar and the banner across the top of a channel page.
 *
 * Both are small images owned by one account, so they share everything except
 * the column they land in. Kept out of routes/auth.js because that file is
 * about credentials, and out of routes/videos.js because these belong to a
 * person rather than to a video.
 */

const express = require('express');
const multer = require('multer');

const { db } = require('../db');
const { storage, keys } = require('../storage');
const { requireAuth } = require('../auth');
const { rateLimit } = require('../security');
const { identify, MAX_BYTES } = require('../images');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1 },
});

const artworkLimit = rateLimit({
  name: 'artwork',
  limit: Number(process.env.BESY_ARTWORK_RATE_LIMIT) || 30,
  windowMs: 60 * 60 * 1000,
  message: 'Слишком много загрузок изображений за час',
  keyFn: (req) => (req.user ? `u${req.user.id}` : req.ip),
});

const KINDS = {
  avatar: { column: 'avatar_file', key: keys.avatar },
  banner: { column: 'banner_file', key: keys.banner },
};

/** Replaces one piece of artwork, removing whatever was there before. */
async function replace(kind, userId, file) {
  const { column, key } = KINDS[kind];
  const image = identify(file.buffer);
  if (!image) return { error: 'Нужен файл JPEG, PNG, WebP или GIF' };

  const previous = db.prepare(`SELECT ${column} AS current FROM users WHERE id = ?`).get(userId).current;
  const storageKey = key(userId, image.ext);

  await storage.putBuffer(storageKey, file.buffer);
  db.prepare(`UPDATE users SET ${column} = ? WHERE id = ?`).run(storageKey, userId);

  // A different extension means a different key, so the old file would linger.
  if (previous && previous !== storageKey) {
    await storage.delete(previous).catch(() => {});
  }
  return { key: storageKey };
}

for (const kind of Object.keys(KINDS)) {
  router.post(`/${kind}`, requireAuth, artworkLimit, upload.single('image'), async (req, res, next) => {
    if (!req.file) return res.status(400).json({ error: 'Файл не получен' });
    try {
      const result = await replace(kind, req.user.id, req.file);
      if (result.error) return res.status(400).json({ error: result.error });
      res.status(201).json({ ok: true, [kind]: `/media/${kind}/${req.user.username}?v=${Date.now()}` });
    } catch (err) {
      next(err);
    }
  });

  router.delete(`/${kind}`, requireAuth, async (req, res, next) => {
    const { column } = KINDS[kind];
    try {
      const current = db.prepare(`SELECT ${column} AS current FROM users WHERE id = ?`).get(req.user.id).current;
      if (!current) return res.status(404).json({ error: 'Изображение не установлено' });
      db.prepare(`UPDATE users SET ${column} = NULL WHERE id = ?`).run(req.user.id);
      await storage.delete(current).catch(() => {});
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });
}

module.exports = router;
