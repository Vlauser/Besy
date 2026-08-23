'use strict';

/**
 * Live streaming: RTMP ingest (node-media-server) plus one ffmpeg per stream
 * that repackages the incoming feed into HLS on local disk.
 */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const { db, DATA_DIR } = require('./db');

const ENABLED = process.env.BESY_LIVE === 'on';
const RTMP_PORT = Number(process.env.BESY_RTMP_PORT) || 1935;
const FFMPEG = process.env.BESY_FFMPEG || 'ffmpeg';
const LIVE_DIR = process.env.BESY_LIVE_DIR
  ? path.resolve(process.env.BESY_LIVE_DIR)
  : path.join(DATA_DIR, 'live');

const encoders = new Map(); // videoId -> { child, watchdog }
const sessionVideos = new Map(); // rtmp session id -> videoId
let server = null;

const STALE_AFTER_MS = Number(process.env.BESY_LIVE_STALE_MS) || 15000;

function liveDir(videoId) {
  return path.join(LIVE_DIR, videoId);
}

function setLiveStatus(videoId, status) {
  db.prepare('UPDATE videos SET live_status = ? WHERE id = ?').run(status, videoId);
}

function videoForKey(streamKey) {
  return db.prepare("SELECT * FROM videos WHERE stream_key = ? AND kind = 'live'").get(streamKey);
}

/** Repackages the RTMP feed into a rolling HLS window. */
function startEncoder(video, streamKey) {
  const dir = liveDir(video.id);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  const args = [
    '-hide_banner', '-loglevel', 'error',
    '-i', `rtmp://127.0.0.1:${RTMP_PORT}/live/${streamKey}`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency',
    '-b:v', '2800k', '-maxrate', '3000k', '-bufsize', '4000k',
    '-g', '50', '-keyint_min', '50', '-sc_threshold', '0',
    '-c:a', 'aac', '-b:a', '128k', '-ac', '2',
    '-f', 'hls',
    '-hls_time', '2',
    '-hls_list_size', '6',
    '-hls_flags', 'delete_segments+independent_segments+omit_endlist',
    '-hls_segment_filename', path.join(dir, 'seg_%05d.ts'),
    path.join(dir, 'index.m3u8'),
  ];

  const child = spawn(FFMPEG, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-2000); });

  child.on('close', (code) => {
    const entry = encoders.get(video.id);
    if (entry) clearInterval(entry.watchdog);
    encoders.delete(video.id);
    if (code !== 0 && stderr.trim()) console.error(`[live] ${video.id}: ${stderr.trim().split('\n').pop()}`);
    if (db.prepare('SELECT live_status FROM videos WHERE id = ?').get(video.id)?.live_status === 'live') {
      console.log(`[live] эфир завершён: ${video.id}`);
      setLiveStatus(video.id, 'ended');
    }
  });

  // ffmpeg keeps waiting on an RTMP input that the ingest server holds open, so
  // a stalled playlist is what actually tells us the broadcaster went away.
  const watchdog = setInterval(() => {
    const playlist = path.join(dir, 'index.m3u8');
    let mtime = 0;
    try {
      mtime = fs.statSync(playlist).mtimeMs;
    } catch {
      return; // not written yet
    }
    if (Date.now() - mtime > STALE_AFTER_MS) {
      console.log(`[live] нет данных ${Math.round(STALE_AFTER_MS / 1000)} с — завершаем эфир ${video.id}`);
      stopEncoder(video.id);
    }
  }, 5000);
  watchdog.unref?.();

  encoders.set(video.id, { child, watchdog });
  return child;
}

function stopEncoder(videoId) {
  const entry = encoders.get(videoId);
  if (!entry) return;
  clearInterval(entry.watchdog);
  entry.child.kill('SIGTERM');
  // ffmpeg blocked on a dead input can ignore SIGTERM; make sure it goes away.
  setTimeout(() => { if (!entry.child.killed) entry.child.kill('SIGKILL'); }, 3000).unref?.();
  encoders.delete(videoId);
}

function start() {
  if (!ENABLED) return null;

  let NodeMediaServer;
  try {
    NodeMediaServer = require('node-media-server');
  } catch {
    console.warn('[live] BESY_LIVE=on, но пакет node-media-server не установлен — эфиры выключены');
    return null;
  }

  fs.mkdirSync(LIVE_DIR, { recursive: true });

  server = new NodeMediaServer({
    bind: process.env.BESY_RTMP_BIND || '0.0.0.0',
    rtmp: { port: RTMP_PORT },
  });

  server.on('postPublish', (session) => {
    const streamKey = session.streamName;
    const video = videoForKey(streamKey);

    if (!video) {
      console.warn(`[live] неизвестный ключ трансляции, соединение закрыто`);
      session.close?.();
      return;
    }
    if (video.blocked_at) {
      session.close?.();
      return;
    }

    console.log(`[live] эфир начался: ${video.id}`);
    sessionVideos.set(session.id, video.id);
    setLiveStatus(video.id, 'live');
    db.prepare('UPDATE videos SET created_at = ? WHERE id = ? AND live_status IS NOT NULL')
      .run(Date.now(), video.id);
    startEncoder(video, streamKey);
  });

  server.on('donePublish', (session) => {
    // Look up by session id: the stream name may already be cleared by now,
    // and the key could have been rotated mid-broadcast.
    const videoId = sessionVideos.get(session.id) || videoForKey(session.streamName)?.id;
    if (!videoId) return;
    sessionVideos.delete(session.id);
    console.log(`[live] эфир завершён: ${videoId}`);
    stopEncoder(videoId);
    setLiveStatus(videoId, 'ended');
  });

  server.run();
  console.log(`[live] RTMP-приём на порту ${RTMP_PORT}`);
  return server;
}

/** Marks streams left "live" by a crash as ended. */
function resetStaleStreams() {
  const stale = db.prepare("SELECT id FROM videos WHERE live_status = 'live'").all();
  for (const row of stale) {
    if (!encoders.has(row.id)) setLiveStatus(row.id, 'ended');
  }
}

module.exports = { start, ENABLED, LIVE_DIR, liveDir, resetStaleStreams, stopEncoder, encoders };
