'use strict';

/**
 * Content matching: compares every new upload against the registered
 * reference works and applies the rights holder's policy.
 *
 * This is a small, self-hosted analogue of a commercial content-ID system:
 * the reference set is whatever rights holders registered on this instance,
 * not a global catalogue.
 */

const crypto = require('node:crypto');
const path = require('node:path');
const fsp = require('node:fs/promises');

const { db, TMP_DIR } = require('./db');
const { storage } = require('./storage');
const fingerprint = require('./fingerprint');
const { notify } = require('./notifications');

const POLICIES = { block: 'Блокировать', flag: 'Отметить заявкой', track: 'Только считать статистику' };

// Long videos are subsampled: matching cost grows with the product of the
// two fingerprint lengths, and a re-upload shows itself in the first minutes.
const MAX_FRAMES = Number(process.env.BESY_MATCH_MAX_FRAMES) || 900;
const MAX_AUDIO_WINDOWS = Number(process.env.BESY_MATCH_MAX_AUDIO) || 4000;

const ENABLED = process.env.BESY_MATCHING !== 'off';

function trim(hashes, limit) {
  return hashes.length > limit ? hashes.slice(0, limit) : hashes;
}

/** Computes both fingerprints for a local file. */
async function fingerprintFile(filePath) {
  const [video, audio] = await Promise.all([
    fingerprint.videoFingerprint(filePath).catch(() => ({ fps: fingerprint.VIDEO_FPS, hashes: [] })),
    fingerprint.audioFingerprint(filePath).catch(() => ({ hashes: [], hopSeconds: 0 })),
  ]);

  return {
    video: { step: 1 / (video.fps || 1), hashes: trim(video.hashes, MAX_FRAMES) },
    audio: {
      step: audio.hopSeconds || fingerprint.AUDIO_HOP / fingerprint.AUDIO_RATE,
      hashes: trim(audio.hashes, MAX_AUDIO_WINDOWS),
    },
  };
}

/** Pulls a video out of storage into a local scratch file when needed. */
async function withLocalCopy(video, handler) {
  if (storage.kind === 'local') return handler(storage.resolve(video.file_key));

  const scratch = path.join(TMP_DIR, `match-${video.id}${path.extname(video.file_key) || '.mp4'}`);
  try {
    await fsp.writeFile(scratch, await storage.getStream(video.file_key));
    return await handler(scratch);
  } finally {
    await fsp.rm(scratch, { force: true }).catch(() => {});
  }
}

/* ------------------------------------------------------------------ works */

async function registerWork({ ownerId, video, title, description, policy }) {
  const id = crypto.randomBytes(9).toString('base64url');
  const prints = await withLocalCopy(video, fingerprintFile);

  if (!prints.video.hashes.length && !prints.audio.hashes.length) {
    throw new Error('Не удалось построить отпечаток — файл не читается');
  }

  db.exec('BEGIN');
  try {
    db.prepare(`
      INSERT INTO reference_works (id, owner_id, video_id, title, description, policy, duration, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, ownerId, video.id, title, description || '',
      POLICIES[policy] ? policy : 'flag', video.duration || 0, Date.now());

    const insert = db.prepare('INSERT INTO reference_prints (work_id, kind, step, hashes) VALUES (?, ?, ?, ?)');
    if (prints.video.hashes.length) insert.run(id, 'video', prints.video.step, JSON.stringify(prints.video.hashes));
    if (prints.audio.hashes.length) insert.run(id, 'audio', prints.audio.step, JSON.stringify(prints.audio.hashes));
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return db.prepare('SELECT * FROM reference_works WHERE id = ?').get(id);
}

/* --------------------------------------------------------------- matching */

function loadReferences(excludeOwnerId) {
  const works = db.prepare(`
    SELECT w.*, u.username AS owner_username, u.display_name AS owner_name
    FROM reference_works w JOIN users u ON u.id = w.owner_id
    WHERE w.active = 1 AND w.owner_id != ?
  `).all(excludeOwnerId ?? -1);

  return works.map((work) => {
    const prints = db.prepare('SELECT kind, step, hashes FROM reference_prints WHERE work_id = ?')
      .all(work.id);
    const byKind = {};
    for (const row of prints) byKind[row.kind] = { step: row.step, hashes: JSON.parse(row.hashes) };
    return { work, prints: byKind };
  });
}

/** Scores one candidate against one reference; returns the strongest signal. */
function compare(candidate, reference) {
  const { MATCH } = fingerprint;
  const results = [];

  if (candidate.video.hashes.length && reference.video?.hashes.length) {
    const aligned = fingerprint.bestAlignment(
      candidate.video.hashes, reference.video.hashes, MATCH.videoDistance
    );
    const seconds = aligned.run * candidate.video.step;
    if (seconds >= MATCH.minVideoSeconds && aligned.distinct >= MATCH.minDistinctHashes) {
      results.push({
        kind: 'video',
        secondsMatched: Number(seconds.toFixed(1)),
        score: Number((aligned.matched / candidate.video.hashes.length).toFixed(3)),
      });
    }
  }

  if (candidate.audio.hashes.length && reference.audio?.hashes.length) {
    const aligned = fingerprint.bestAlignment(
      candidate.audio.hashes, reference.audio.hashes, MATCH.audioDistance
    );
    const fraction = aligned.matched / candidate.audio.hashes.length;
    const seconds = aligned.matched * candidate.audio.step;
    if (fraction >= MATCH.minAudioFraction && seconds >= MATCH.minAudioSeconds
        && aligned.distinct >= MATCH.minDistinctHashes) {
      results.push({
        kind: 'audio',
        secondsMatched: Number(seconds.toFixed(1)),
        score: Number(fraction.toFixed(3)),
      });
    }
  }

  if (!results.length) return null;
  return results.sort((a, b) => b.secondsMatched - a.secondsMatched)[0];
}

function applyPolicy(video, work, match) {
  const label = `«${work.title}» (${work.owner_name})`;

  if (work.policy === 'block') {
    db.prepare('UPDATE videos SET blocked_at = ?, blocked_reason = ? WHERE id = ?')
      .run(Date.now(), `Совпадение с защищённым контентом: ${work.title}`, video.id);
    notify({
      userId: video.user_id,
      type: 'copyright',
      videoId: video.id,
      body: `Видео заблокировано: совпадение с ${label}. Вы можете оспорить заявку.`,
    });
  } else if (work.policy === 'flag') {
    notify({
      userId: video.user_id,
      type: 'copyright',
      videoId: video.id,
      body: `На видео подана заявка правообладателя: совпадение с ${label}.`,
    });
    notify({
      userId: work.owner_id,
      type: 'copyright',
      videoId: video.id,
      body: `Найдено совпадение с вашей работой ${label}.`,
    });
  }
}

/**
 * Fingerprints a video and records a claim for every reference it matches.
 * Returns the claims that were created.
 */
async function scanVideo(videoId) {
  if (!ENABLED) return [];

  const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(videoId);
  if (!video || video.kind === 'live') return [];

  const references = loadReferences(video.user_id);
  if (!references.length) return [];

  const candidate = await withLocalCopy(video, fingerprintFile);
  if (!candidate.video.hashes.length && !candidate.audio.hashes.length) return [];

  const created = [];
  for (const { work, prints } of references) {
    const match = compare(candidate, prints);
    if (!match) continue;

    const existing = db.prepare('SELECT id FROM content_matches WHERE video_id = ? AND work_id = ?')
      .get(video.id, work.id);
    if (existing) continue;

    db.prepare(`
      INSERT INTO content_matches (video_id, work_id, kind, seconds_matched, score, policy, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(video.id, work.id, match.kind, match.secondsMatched, match.score, work.policy, Date.now());

    applyPolicy(video, work, match);
    created.push({ workId: work.id, ...match, policy: work.policy });
    console.log(`[match] ${video.id} ↔ ${work.id} (${match.kind}, ${match.secondsMatched}s, ${work.policy})`);
  }

  return created;
}

module.exports = { scanVideo, registerWork, fingerprintFile, compare, POLICIES, ENABLED };
