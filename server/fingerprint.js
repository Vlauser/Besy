'use strict';

/**
 * Perceptual fingerprints used for content matching.
 *
 * Video: one 64-bit dHash per sampled frame. dHash compares horizontally
 * adjacent pixels, so it survives re-encoding, rescaling and mild colour
 * shifts while still separating unrelated footage.
 *
 * Audio: one 32-bit hash per window, built from the sign of the energy
 * difference between neighbouring frequency bands across time — the same
 * shape as the classic Haitsma-Kalker fingerprint, which is robust to
 * bitrate changes and volume normalisation.
 */

const { spawn } = require('node:child_process');

const FFMPEG = process.env.BESY_FFMPEG || 'ffmpeg';

const FRAME_SIZE = { width: 9, height: 8 }; // dHash needs one extra column
const VIDEO_FPS = Number(process.env.BESY_FINGERPRINT_FPS) || 1; // frames per second sampled
const AUDIO_RATE = 8000;
const AUDIO_WINDOW = 2048; // 256 ms at 8 kHz
const AUDIO_HOP = Number(process.env.BESY_AUDIO_HOP) || 512; // 64 ms step
// 17 edges -> 15 bits per window. Wider bands survive low-bitrate re-encodes
// better than narrow ones, which is what a re-upload actually looks like.
const AUDIO_BANDS = Number(process.env.BESY_AUDIO_BANDS) || 17;

function runCapture(args, { maxBytes = 96 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [];
    let size = 0;
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        child.kill('SIGKILL');
        reject(new Error('слишком много данных для отпечатка'));
        return;
      }
      chunks.push(chunk);
    });
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-2000); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0 || chunks.length) resolve(Buffer.concat(chunks));
      else reject(new Error(`ffmpeg ${code}: ${stderr.trim().split('\n').pop() || 'нет вывода'}`));
    });
  });
}

/* ------------------------------------------------------------------- video */

/** Turns one 9x8 grayscale frame into a 64-bit hash as a 16-char hex string. */
function frameToHash(frame) {
  let bits = 0n;
  let index = 0n;

  for (let y = 0; y < FRAME_SIZE.height; y += 1) {
    const row = y * FRAME_SIZE.width;
    for (let x = 0; x < FRAME_SIZE.width - 1; x += 1) {
      if (frame[row + x] > frame[row + x + 1]) bits |= 1n << index;
      index += 1n;
    }
  }

  return bits.toString(16).padStart(16, '0');
}

async function videoFingerprint(filePath, { fps = VIDEO_FPS, maxSeconds = 0 } = {}) {
  const args = ['-hide_banner', '-loglevel', 'error'];
  if (maxSeconds > 0) args.push('-t', String(maxSeconds));

  args.push(
    '-i', filePath,
    '-vf', `fps=${fps},scale=${FRAME_SIZE.width}:${FRAME_SIZE.height}:flags=area,format=gray`,
    '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1',
  );

  const raw = await runCapture(args);
  const frameBytes = FRAME_SIZE.width * FRAME_SIZE.height;
  const hashes = [];

  for (let offset = 0; offset + frameBytes <= raw.length; offset += frameBytes) {
    hashes.push(frameToHash(raw.subarray(offset, offset + frameBytes)));
  }

  return { fps, hashes };
}

/* ------------------------------------------------------------------- audio */

/** In-place iterative radix-2 FFT; `re` and `im` must have a power-of-two length. */
function fft(re, im) {
  const n = re.length;

  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const wRe = Math.cos(angle);
    const wIm = Math.sin(angle);

    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < len / 2; k += 1) {
        const aRe = re[i + k];
        const aIm = im[i + k];
        const bRe = re[i + k + len / 2] * curRe - im[i + k + len / 2] * curIm;
        const bIm = re[i + k + len / 2] * curIm + im[i + k + len / 2] * curRe;

        re[i + k] = aRe + bRe;
        im[i + k] = aIm + bIm;
        re[i + k + len / 2] = aRe - bRe;
        im[i + k + len / 2] = aIm - bIm;

        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}

/** Logarithmically spaced band edges between 300 Hz and 3 kHz — the speech/music core. */
function bandEdges(windowSize, sampleRate) {
  const low = 300;
  const high = 3000;
  const edges = [];
  for (let i = 0; i < AUDIO_BANDS; i += 1) {
    const freq = low * (high / low) ** (i / (AUDIO_BANDS - 1));
    edges.push(Math.round((freq / sampleRate) * windowSize));
  }
  return edges;
}

function audioHashes(samples, sampleRate) {
  const edges = bandEdges(AUDIO_WINDOW, sampleRate);
  const hann = new Float64Array(AUDIO_WINDOW);
  for (let i = 0; i < AUDIO_WINDOW; i += 1) {
    hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (AUDIO_WINDOW - 1)));
  }

  const energies = [];
  for (let start = 0; start + AUDIO_WINDOW <= samples.length; start += AUDIO_HOP) {
    const re = new Float64Array(AUDIO_WINDOW);
    const im = new Float64Array(AUDIO_WINDOW);
    for (let i = 0; i < AUDIO_WINDOW; i += 1) re[i] = samples[start + i] * hann[i];

    fft(re, im);

    const bands = new Float64Array(AUDIO_BANDS - 1);
    for (let b = 0; b < AUDIO_BANDS - 1; b += 1) {
      let sum = 0;
      for (let k = edges[b]; k < edges[b + 1]; k += 1) {
        sum += re[k] * re[k] + im[k] * im[k];
      }
      bands[b] = Math.log10(sum + 1e-12);
    }
    energies.push(bands);
  }

  // One bit per band pair, comparing this window against the previous one.
  const hashes = [];
  for (let t = 1; t < energies.length; t += 1) {
    let bits = 0;
    for (let b = 0; b < AUDIO_BANDS - 2; b += 1) {
      const diff = (energies[t][b] - energies[t][b + 1]) - (energies[t - 1][b] - energies[t - 1][b + 1]);
      if (diff > 0) bits |= 1 << b;
    }
    hashes.push((bits >>> 0).toString(16).padStart(Math.ceil((AUDIO_BANDS - 2) / 4), '0'));
  }

  return hashes;
}

async function audioFingerprint(filePath, { maxSeconds = 0 } = {}) {
  const args = ['-hide_banner', '-loglevel', 'error'];
  if (maxSeconds > 0) args.push('-t', String(maxSeconds));

  args.push(
    '-i', filePath,
    '-vn', '-ac', '1', '-ar', String(AUDIO_RATE),
    '-f', 's16le', '-acodec', 'pcm_s16le', 'pipe:1',
  );

  let raw;
  try {
    raw = await runCapture(args);
  } catch {
    return { hashes: [], hopSeconds: AUDIO_HOP / AUDIO_RATE }; // no audio track
  }

  if (raw.length < AUDIO_WINDOW * 2) return { hashes: [], hopSeconds: AUDIO_HOP / AUDIO_RATE };

  const samples = new Float64Array(raw.length / 2);
  for (let i = 0; i < samples.length; i += 1) samples[i] = raw.readInt16LE(i * 2) / 32768;

  return { hashes: audioHashes(samples, AUDIO_RATE), hopSeconds: AUDIO_HOP / AUDIO_RATE };
}

/* ---------------------------------------------------------------- matching */

const POPCOUNT = new Uint8Array(256);
for (let i = 0; i < 256; i += 1) POPCOUNT[i] = (i & 1) + POPCOUNT[i >> 1];

function hammingHex(a, b) {
  let distance = 0;
  for (let i = 0; i < a.length; i += 2) {
    distance += POPCOUNT[parseInt(a.slice(i, i + 2), 16) ^ parseInt(b.slice(i, i + 2), 16)];
  }
  return distance;
}

/**
 * Finds the longest run of consecutive candidate hashes that matches the
 * reference at a fixed offset — the shape a real re-upload leaves behind.
 * Returns the best alignment with the number of matched positions.
 */
function bestAlignment(candidate, reference, maxDistance) {
  const empty = { matched: 0, run: 0, offset: 0, distinct: 0 };
  if (!candidate.length || !reference.length) return empty;

  let best = empty;

  for (let offset = -(candidate.length - 1); offset < reference.length; offset += 1) {
    let matched = 0;
    let run = 0;
    let longestRun = 0;
    const seen = new Set();

    for (let i = 0; i < candidate.length; i += 1) {
      const j = i + offset;
      if (j < 0 || j >= reference.length) { run = 0; continue; }
      if (hammingHex(candidate[i], reference[j]) <= maxDistance) {
        matched += 1;
        run += 1;
        seen.add(candidate[i]);
        if (run > longestRun) longestRun = run;
      } else {
        run = 0;
      }
    }

    if (longestRun > best.run || (longestRun === best.run && matched > best.matched)) {
      best = { matched, run: longestRun, offset, distinct: seen.size };
    }
  }

  return best;
}

/** Thresholds tuned on re-encoded, rescaled and trimmed copies. */
const MATCH = {
  videoDistance: 10, // of 64 bits
  audioDistance: 4, // of 15 bits
  minVideoSeconds: 5, // consecutive
  minAudioFraction: 0.45,
  minAudioSeconds: 5,
  // A still frame or silence hashes to the same value over and over, and any
  // near-enough reference frame would then "match" the whole thing. Requiring
  // several distinct hashes means a claim rests on content that actually moves.
  minDistinctHashes: 4,
};

module.exports = {
  MATCH,
  videoFingerprint,
  audioFingerprint,
  audioHashes,
  frameToHash,
  hammingHex,
  bestAlignment,
  fft,
  VIDEO_FPS,
  AUDIO_HOP,
  AUDIO_RATE,
};
