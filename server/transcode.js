'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const { db, TMP_DIR } = require('./db');
const { storage, keys } = require('./storage');

const FFMPEG = process.env.BESY_FFMPEG || 'ffmpeg';
const FFPROBE = process.env.BESY_FFPROBE || 'ffprobe';
const CONCURRENCY = Math.max(1, Number(process.env.BESY_TRANSCODE_CONCURRENCY) || 1);
const ENABLED = process.env.BESY_TRANSCODE !== 'off';

/** Bitrate ladder; only rungs at or below the source height are produced. */
const LADDER = [
  { name: '360p', height: 360, videoBitrate: '800k', maxrate: '900k', bufsize: '1200k', audioBitrate: '96k' },
  { name: '480p', height: 480, videoBitrate: '1400k', maxrate: '1600k', bufsize: '2100k', audioBitrate: '128k' },
  { name: '720p', height: 720, videoBitrate: '2800k', maxrate: '3100k', bufsize: '4200k', audioBitrate: '128k' },
  { name: '1080p', height: 1080, videoBitrate: '5000k', maxrate: '5500k', bufsize: '7500k', audioBitrate: '192k' },
];

let toolsAvailable = null;

/** Checks once whether ffmpeg/ffprobe are actually callable. */
async function checkTools() {
  if (toolsAvailable !== null) return toolsAvailable;
  try {
    await run(FFMPEG, ['-hide_banner', '-version']);
    await run(FFPROBE, ['-hide_banner', '-version']);
    toolsAvailable = true;
  } catch {
    toolsAvailable = false;
  }
  return toolsAvailable;
}

function run(command, args, { onStderr } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => {
      const text = String(chunk);
      stderr = (stderr + text).slice(-4000);
      if (onStderr) onStderr(text);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${path.basename(command)} завершился с кодом ${code}: ${stderr.trim().split('\n').slice(-3).join(' ')}`));
    });
  });
}

async function probe(filePath) {
  const { stdout } = await run(FFPROBE, [
    '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath,
  ]);
  const data = JSON.parse(stdout);
  const video = (data.streams || []).find((s) => s.codec_type === 'video');
  const audio = (data.streams || []).find((s) => s.codec_type === 'audio');

  return {
    duration: Number(data.format?.duration) || Number(video?.duration) || 0,
    width: Number(video?.width) || 0,
    height: Number(video?.height) || 0,
    videoCodec: video?.codec_name || null,
    audioCodec: audio?.codec_name || null,
    hasVideo: Boolean(video),
    hasAudio: Boolean(audio),
  };
}

async function makeThumbnail(filePath, outPath, atSecond) {
  await run(FFMPEG, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-ss', String(Math.max(0, atSecond)),
    '-i', filePath,
    '-frames:v', '1',
    '-vf', 'scale=640:-2',
    '-q:v', '3',
    outPath,
  ]);
}

function pickRenditions(sourceHeight) {
  const fits = LADDER.filter((rung) => rung.height <= (sourceHeight || 0));
  return fits.length ? fits : [LADDER[0]];
}

/**
 * Produces one HLS variant per rung in a single ffmpeg pass and returns the
 * rendition descriptors that go into the master playlist.
 */
async function buildHls(filePath, outDir, meta, onProgress) {
  const renditions = pickRenditions(meta.height);
  await fsp.mkdir(outDir, { recursive: true });
  await Promise.all(renditions.map((_, i) => fsp.mkdir(path.join(outDir, `v${i}`), { recursive: true })));

  const splits = renditions.map((_, i) => `[v${i}]`).join('');
  const filters = [`[0:v]split=${renditions.length}${splits}`];
  renditions.forEach((rung, i) => {
    // -2 keeps the aspect ratio and guarantees an even width for H.264.
    filters.push(`[v${i}]scale=w=-2:h=${rung.height}[v${i}out]`);
  });

  const args = [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', filePath,
    '-filter_complex', filters.join(';'),
  ];

  renditions.forEach((rung, i) => {
    args.push(
      '-map', `[v${i}out]`,
      `-c:v:${i}`, 'libx264', '-preset', 'veryfast', '-profile:v', 'main', '-crf', '23',
      `-b:v:${i}`, rung.videoBitrate, `-maxrate:v:${i}`, rung.maxrate, `-bufsize:v:${i}`, rung.bufsize,
      '-g', '48', '-keyint_min', '48', '-sc_threshold', '0',
    );
  });

  if (meta.hasAudio) {
    renditions.forEach((rung, i) => {
      args.push('-map', 'a:0', `-c:a:${i}`, 'aac', `-b:a:${i}`, rung.audioBitrate, '-ac', '2');
    });
  }

  const streamMap = renditions
    .map((rung, i) => (meta.hasAudio ? `v:${i},a:${i},name:${rung.name}` : `v:${i},name:${rung.name}`))
    .join(' ');

  args.push(
    '-var_stream_map', streamMap,
    '-master_pl_name', 'master.m3u8',
    '-f', 'hls',
    '-hls_time', '4',
    '-hls_playlist_type', 'vod',
    '-hls_flags', 'independent_segments',
    '-hls_segment_filename', path.join(outDir, 'v%v', 'seg_%03d.ts'),
    '-progress', 'pipe:2', '-nostats',
    path.join(outDir, 'v%v', 'index.m3u8'),
  );

  let buffer = '';
  await run(FFMPEG, args, {
    onStderr(text) {
      if (!onProgress || !meta.duration) return;
      buffer += text;
      const matches = buffer.match(/out_time_ms=(\d+)/g);
      if (!matches) return;
      buffer = buffer.slice(-200);
      const micros = Number(matches[matches.length - 1].split('=')[1]);
      onProgress(Math.min(99, Math.round((micros / 1e6 / meta.duration) * 100)));
    },
  });

  return renditions.map((rung, i) => ({
    name: rung.name,
    height: rung.height,
    playlist: `v${i}/index.m3u8`,
  }));
}

/** Uploads a finished HLS folder into storage, preserving relative paths. */
async function uploadDirectory(localDir, videoId) {
  const entries = await fsp.readdir(localDir, { withFileTypes: true, recursive: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const absolute = path.join(entry.parentPath || entry.path, entry.name);
    const relative = path.relative(localDir, absolute).split(path.sep).join('/');
    await storage.putFile(keys.hlsFile(videoId, relative), absolute);
  }
}

/* --------------------------------------------------------------- job queue */

const queue = [];
const queued = new Set();
let running = 0;

function setStatus(videoId, fields) {
  const columns = Object.keys(fields);
  db.prepare(`UPDATE videos SET ${columns.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`)
    .run(...columns.map((c) => fields[c]), videoId);
}

async function processVideo(videoId) {
  const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(videoId);
  if (!video) return;

  const workDir = path.join(TMP_DIR, `job-${videoId}`);
  const sourcePath = path.join(workDir, `source${path.extname(video.file_key) || '.mp4'}`);

  try {
    setStatus(videoId, { status: 'processing', progress: 0, status_error: null });
    await fsp.mkdir(workDir, { recursive: true });

    // ffmpeg needs a seekable local file; the local driver already has one.
    const localSource = storage.kind === 'local'
      ? storage.resolve(video.file_key)
      : sourcePath;
    if (localSource === sourcePath) {
      await fsp.writeFile(sourcePath, await storage.getStream(video.file_key));
    }

    const meta = await probe(localSource);
    if (!meta.hasVideo) throw new Error('В файле нет видеодорожки');

    setStatus(videoId, {
      duration: meta.duration || video.duration,
      width: meta.width || video.width,
      height: meta.height || video.height,
      progress: 5,
    });

    if (!video.thumb_key) {
      const thumbPath = path.join(workDir, 'thumb.jpg');
      await makeThumbnail(localSource, thumbPath, Math.min(3, (meta.duration || 3) / 3));
      await storage.putFile(keys.thumb(videoId), thumbPath);
      setStatus(videoId, { thumb_key: keys.thumb(videoId) });
    }

    const hlsDir = path.join(workDir, 'hls');
    const renditions = await buildHls(localSource, hlsDir, meta, (percent) => {
      setStatus(videoId, { progress: percent });
    });

    await uploadDirectory(hlsDir, videoId);

    setStatus(videoId, {
      status: 'ready',
      progress: 100,
      hls_master: keys.hlsMaster(videoId),
      renditions: JSON.stringify(renditions),
      status_error: null,
    });
  } catch (err) {
    console.error(`[transcode] ${videoId}: ${err.message}`);
    // The original file is untouched, so the video stays watchable progressively.
    setStatus(videoId, { status: 'failed', progress: 0, status_error: err.message.slice(0, 500) });
  } finally {
    await fsp.rm(workDir, { recursive: true, force: true });
    queued.delete(videoId);
    running -= 1;
    pump();
  }
}

function pump() {
  while (running < CONCURRENCY && queue.length) {
    const videoId = queue.shift();
    running += 1;
    processVideo(videoId);
  }
}

/** Schedules a video for transcoding; resolves to false when transcoding is unavailable. */
async function enqueue(videoId) {
  if (!ENABLED || !(await checkTools())) return false;
  if (queued.has(videoId)) return true;
  queued.add(videoId);
  queue.push(videoId);
  pump();
  return true;
}

/** Picks up jobs that were interrupted by a restart. */
async function resumePending() {
  if (!ENABLED || !(await checkTools())) {
    const stuck = db.prepare("SELECT id FROM videos WHERE status = 'processing'").all();
    for (const row of stuck) setStatus(row.id, { status: 'ready', progress: 0 });
    return;
  }
  const pending = db.prepare("SELECT id FROM videos WHERE status = 'processing' ORDER BY created_at").all();
  for (const row of pending) enqueue(row.id);
  if (pending.length) console.log(`[transcode] возобновлено задач: ${pending.length}`);
}

module.exports = { enqueue, resumePending, checkTools, probe, makeThumbnail, LADDER, ENABLED };
