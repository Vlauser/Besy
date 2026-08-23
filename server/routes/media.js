'use strict';

const express = require('express');
const path = require('node:path');

const { db } = require('../db');
const { storage, keys } = require('../storage');
const { SIGNED_MEDIA, verifyMediaToken, viewerKey } = require('../security');

const router = express.Router();

const HLS_CONTENT_TYPES = {
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.ts': 'video/mp2t',
  '.m4s': 'video/iso.segment',
  '.mp4': 'video/mp4',
};

function loadVideo(req, res) {
  const row = db.prepare('SELECT * FROM videos WHERE id = ?').get(req.params.id);
  if (!row) {
    res.status(404).end();
    return null;
  }
  const isOwner = req.user && req.user.id === row.user_id;
  if (row.visibility === 'private' && !isOwner) {
    res.status(403).end();
    return null;
  }
  if (row.blocked_at && !isOwner && !req.user?.isAdmin) {
    res.status(451).end();
    return null;
  }
  if (row.age_restricted && !req.user) {
    res.status(403).end();
    return null;
  }
  // Optional hotlink protection: playback URLs expire and are bound to a viewer.
  if (SIGNED_MEDIA && !isOwner && !verifyMediaToken(row.id, viewerKey(req), req.query.token)) {
    res.status(403).end();
    return null;
  }
  return row;
}

function pipeStream(stream, res) {
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy?.());
  stream.pipe(res);
}

/** Streams the original file, honouring HTTP Range so users can seek. */
router.get('/stream/:id', async (req, res, next) => {
  const row = loadVideo(req, res);
  if (!row) return;

  try {
    const info = await storage.stat(row.file_key);
    if (!info) return res.status(404).end();

    const total = info.size;
    const range = req.headers.range;

    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', row.mime_type);
    res.setHeader('Cache-Control', 'private, max-age=3600');

    if (!range) {
      res.setHeader('Content-Length', total);
      return pipeStream(await storage.getStream(row.file_key), res);
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
      start = Math.max(total - end, 0); // Suffix range: the last N bytes.
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
    pipeStream(await storage.getStream(row.file_key, { start, end }), res);
  } catch (err) {
    next(err);
  }
});

/** Serves HLS playlists and segments produced by the transcoder. */
router.get('/hls/:id/*', async (req, res, next) => {
  const row = loadVideo(req, res);
  if (!row) return;

  const relative = String(req.params[0] || '').replace(/^\/+/, '');
  if (!relative || relative.includes('..')) return res.status(400).end();

  try {
    const key = keys.hlsFile(row.id, relative);
    const info = await storage.stat(key);
    if (!info) return res.status(404).end();

    const type = HLS_CONTENT_TYPES[path.extname(relative).toLowerCase()] || 'application/octet-stream';
    res.setHeader('Content-Type', type);
    res.setHeader('Content-Length', info.size);
    // Playlists are immutable once a VOD finishes, segments even more so.
    res.setHeader('Cache-Control', 'private, max-age=604800');
    pipeStream(await storage.getStream(key), res);
  } catch (err) {
    next(err);
  }
});

router.get('/download/:id', async (req, res, next) => {
  const row = loadVideo(req, res);
  if (!row) return;

  try {
    const info = await storage.stat(row.file_key);
    if (!info) return res.status(404).end();

    const safeName = row.title.replace(/[^\p{L}\p{N} ._-]/gu, '').trim() || row.id;
    res.setHeader('Content-Type', row.mime_type);
    res.setHeader('Content-Length', info.size);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(safeName + path.extname(row.file_key))}`
    );
    pipeStream(await storage.getStream(row.file_key), res);
  } catch (err) {
    next(err);
  }
});

router.get('/thumb/:id', async (req, res, next) => {
  const row = db.prepare('SELECT id, thumb_key, visibility, user_id FROM videos WHERE id = ?')
    .get(req.params.id);
  if (!row || !row.thumb_key) return res.status(404).end();
  if (row.visibility === 'private' && (!req.user || req.user.id !== row.user_id)) {
    return res.status(403).end();
  }

  try {
    const info = await storage.stat(row.thumb_key);
    if (!info) return res.status(404).end();
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Content-Length', info.size);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    pipeStream(await storage.getStream(row.thumb_key), res);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
