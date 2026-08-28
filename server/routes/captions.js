'use strict';

const express = require('express');
const multer = require('multer');
const crypto = require('node:crypto');
const fs = require('node:fs');

const { db, TMP_DIR } = require('../db');
const { storage, keys } = require('../storage');
const { requireAuth } = require('../auth');

const router = express.Router();

const MAX_CAPTION_BYTES = 2 * 1024 * 1024;
const upload = multer({ dest: TMP_DIR, limits: { fileSize: MAX_CAPTION_BYTES, files: 1 } });

const LANGUAGES = {
  ru: 'Русский', en: 'English', uk: 'Українська', de: 'Deutsch', fr: 'Français',
  es: 'Español', pt: 'Português', it: 'Italiano', tr: 'Türkçe', pl: 'Polski',
  kk: 'Қазақша', zh: '中文', ja: '日本語', ko: '한국어', ar: 'العربية',
};

/** Converts SubRip to WebVTT; already-WebVTT input is passed through. */
function toWebVtt(source) {
  const text = source.replace(/^﻿/, '').replace(/\r\n/g, '\n').trim();
  if (/^WEBVTT/.test(text)) return text;

  const converted = text
    .split(/\n\n+/)
    .map((block) => {
      const lines = block.split('\n');
      // Drop the numeric counter SubRip puts before each cue.
      if (/^\d+$/.test(lines[0])) lines.shift();
      if (!lines.length) return null;
      lines[0] = lines[0].replace(
        /(\d{2}:\d{2}:\d{2}),(\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}),(\d{3})/,
        '$1.$2 --> $3.$4'
      );
      return lines.join('\n');
    })
    .filter(Boolean)
    .join('\n\n');

  return `WEBVTT\n\n${converted}`;
}

function isValidVtt(text) {
  return /^WEBVTT/.test(text) && /\d{2}:\d{2}(:\d{2})?\.\d{3}\s*-->/.test(text);
}

function shapeCaption(row) {
  return {
    id: row.id,
    lang: row.lang,
    label: row.label,
    isDefault: row.is_default === 1,
    url: `/media/captions/${row.video_id}/${row.id}.vtt`,
    createdAt: row.created_at,
  };
}

router.get('/languages', (req, res) => {
  res.json({ languages: Object.entries(LANGUAGES).map(([id, label]) => ({ id, label })) });
});

router.get('/:videoId', (req, res) => {
  const rows = db.prepare('SELECT * FROM captions WHERE video_id = ? ORDER BY is_default DESC, label')
    .all(req.params.videoId);
  res.json({ captions: rows.map(shapeCaption) });
});

router.post('/:videoId', requireAuth, upload.single('file'), async (req, res, next) => {
  const video = db.prepare('SELECT id, user_id FROM videos WHERE id = ?').get(req.params.videoId);

  try {
    if (!video) return res.status(404).json({ error: 'Видео не найдено' });
    if (video.user_id !== req.user.id) return res.status(403).json({ error: 'Это не ваше видео' });
    if (!req.file) return res.status(400).json({ error: 'Файл субтитров не выбран' });

    const lang = String(req.body.lang || 'ru').toLowerCase().slice(0, 8);
    const label = String(req.body.label || LANGUAGES[lang] || lang).slice(0, 60);

    const raw = await fs.promises.readFile(req.file.path, 'utf8');
    const vtt = toWebVtt(raw);
    if (!isValidVtt(vtt)) {
      return res.status(400).json({ error: 'Не удалось разобрать файл — нужен WebVTT или SRT' });
    }

    const existing = db.prepare('SELECT * FROM captions WHERE video_id = ? AND lang = ?')
      .get(video.id, lang);
    const id = existing ? existing.id : crypto.randomBytes(6).toString('base64url');
    const key = keys.caption(video.id, id);
    await storage.putBuffer(key, Buffer.from(vtt, 'utf8'));

    const makeDefault = req.body.isDefault === 'true' || req.body.isDefault === '1';
    if (makeDefault) {
      db.prepare('UPDATE captions SET is_default = 0 WHERE video_id = ?').run(video.id);
    }

    if (existing) {
      db.prepare('UPDATE captions SET label = ?, is_default = ? WHERE id = ?')
        .run(label, makeDefault ? 1 : existing.is_default, id);
    } else {
      const isFirst = db.prepare('SELECT COUNT(*) AS n FROM captions WHERE video_id = ?').get(video.id).n === 0;
      db.prepare(`
        INSERT INTO captions (id, video_id, lang, label, file_key, is_default, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, video.id, lang, label, key, makeDefault || isFirst ? 1 : 0, Date.now());
    }

    const row = db.prepare('SELECT * FROM captions WHERE id = ?').get(id);
    res.status(201).json({ caption: shapeCaption(row) });
  } catch (err) {
    next(err);
  } finally {
    if (req.file) await fs.promises.rm(req.file.path, { force: true }).catch(() => {});
  }
});

router.delete('/:videoId/:captionId', requireAuth, async (req, res, next) => {
  const row = db.prepare(`
    SELECT c.*, v.user_id FROM captions c JOIN videos v ON v.id = c.video_id
    WHERE c.id = ? AND c.video_id = ?
  `).get(req.params.captionId, req.params.videoId);

  if (!row) return res.status(404).json({ error: 'Субтитры не найдены' });
  if (row.user_id !== req.user.id) return res.status(403).json({ error: 'Это не ваше видео' });

  try {
    db.prepare('DELETE FROM captions WHERE id = ?').run(row.id);
    await storage.delete(row.file_key);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
module.exports.toWebVtt = toWebVtt;
