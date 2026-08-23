'use strict';

const express = require('express');
const fs = require('node:fs');
const path = require('node:path');

const { db, VIDEO_DIR, THUMB_DIR } = require('../db');

const router = express.Router();

function loadVideo(req, res) {
  const row = db.prepare('SELECT * FROM videos WHERE id = ?').get(req.params.id);
  if (!row) {
    res.status(404).end();
    return null;
  }
  if (row.visibility === 'private' && (!req.user || req.user.id !== row.user_id)) {
    res.status(403).end();
    return null;
  }
  return row;
}

/** Streams the file, honouring HTTP Range so users can seek. */
router.get('/stream/:id', (req, res) => {
  const row = loadVideo(req, res);
  if (!row) return;

  const filePath = path.join(VIDEO_DIR, row.file_name);
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return res.status(404).end();
  }

  const total = stat.size;
  const range = req.headers.range;

  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', row.mime_type);
  res.setHeader('Cache-Control', 'private, max-age=3600');

  if (!range) {
    res.setHeader('Content-Length', total);
    return fs.createReadStream(filePath).pipe(res);
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!match) {
    res.setHeader('Content-Range', `bytes */${total}`);
    return res.status(416).end();
  }

  let start = match[1] === '' ? null : Number(match[1]);
  let end = match[2] === '' ? null : Number(match[2]);

  if (start === null && end === null) {
    res.setHeader('Content-Range', `bytes */${total}`);
    return res.status(416).end();
  }
  if (start === null) {
    // Suffix range: last N bytes.
    start = Math.max(total - end, 0);
    end = total - 1;
  } else if (end === null || end >= total) {
    end = total - 1;
  }

  if (start > end || start >= total) {
    res.setHeader('Content-Range', `bytes */${total}`);
    return res.status(416).end();
  }

  res.status(206);
  res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
  res.setHeader('Content-Length', end - start + 1);
  fs.createReadStream(filePath, { start, end }).pipe(res);
});

router.get('/download/:id', (req, res) => {
  const row = loadVideo(req, res);
  if (!row) return;
  const safeName = row.title.replace(/[^\p{L}\p{N} ._-]/gu, '').trim() || row.id;
  res.download(path.join(VIDEO_DIR, row.file_name), `${safeName}${path.extname(row.file_name)}`);
});

router.get('/thumb/:id', (req, res) => {
  const row = db.prepare('SELECT thumb_file, visibility, user_id FROM videos WHERE id = ?').get(req.params.id);
  if (!row || !row.thumb_file) return res.status(404).end();
  if (row.visibility === 'private' && (!req.user || req.user.id !== row.user_id)) return res.status(403).end();

  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(path.join(THUMB_DIR, row.thumb_file));
});

module.exports = router;
