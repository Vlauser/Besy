'use strict';

/** Shared HTTP client and fixtures for the end-to-end test scripts. */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const BASE = process.env.BESY_URL || 'http://127.0.0.1:3000';
const DATA_DIR = process.env.BESY_DATA_DIR || path.join(__dirname, '..', '..', 'data');

/** One client is one browser: its own cookie jar and CSRF token. */
function createClient(baseUrl = BASE) {
  const jar = new Map();

  const cookieHeader = () => Array.from(jar.entries()).map(([k, v]) => `${k}=${v}`).join('; ');

  function storeCookie(pair) {
    const [name, value] = pair.split('=');
    if (value === '') jar.delete(name);
    else jar.set(name, value);
  }

  async function call(method, url, body, raw = false) {
    const headers = { cookie: cookieHeader() };
    const csrf = jar.get('besy_csrf');
    if (csrf) headers['x-csrf-token'] = csrf;

    const init = { method, headers, redirect: 'manual' };
    if (body !== undefined && !raw) {
      headers['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    } else if (raw) {
      init.body = body;
    }

    const res = await fetch(baseUrl + url, init);
    for (const c of res.headers.getSetCookie?.() || []) storeCookie(c.split(';')[0]);

    const text = await res.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
    return { status: res.status, data, headers: res.headers };
  }

  /** Raw fetch that still carries the jar — for range requests and media. */
  const fetchRaw = (url, options = {}) => fetch(baseUrl + url, {
    ...options,
    headers: { cookie: cookieHeader(), ...(options.headers || {}) },
  });

  return {
    jar,
    baseUrl,
    call,
    fetchRaw,
    cookieHeader,
    get: (url) => call('GET', url),
    post: (url, body) => call('POST', url, body),
    patch: (url, body) => call('PATCH', url, body),
    del: (url, body) => call('DELETE', url, body),
    signOut: () => jar.delete('besy_session'),
  };
}

function hasFfmpeg() {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** A real clip when ffmpeg is around, otherwise a stub the server never decodes. */
function makeSampleVideo({ real = false, size = '640x360', duration = 4 } = {}) {
  const file = path.join(os.tmpdir(), `besy-${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`);
  if (real && hasFfmpeg()) {
    execFileSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', `testsrc=size=${size}:rate=25:duration=${duration}`,
      '-f', 'lavfi', '-i', `sine=frequency=440:duration=${duration}`,
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-shortest', '-movflags', '+faststart', file,
    ], { stdio: 'ignore' });
    return file;
  }
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmp42'), Buffer.alloc(64 * 1024, 0x21),
  ]));
  return file;
}

async function uploadVideo(client, filePath, fields = {}) {
  const form = new FormData();
  form.append('video', new Blob([fs.readFileSync(filePath)], { type: 'video/mp4' }), path.basename(filePath));
  if (!fields.title) form.append('title', 'Тестовое видео');
  for (const [key, value] of Object.entries(fields)) form.append(key, String(value));
  return client.call('POST', '/api/videos', form, true);
}

async function waitForStatus(client, videoId, statuses, timeoutMs = 180000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const res = await client.get(`/api/videos/${videoId}`);
    last = res.data.video;
    if (last && statuses.includes(last.status)) return last;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`видео ${videoId} застряло в статусе ${last && last.status}`);
}

/** Reads the newest letter written by the file transport and pulls a token out. */
function readTokenFromOutbox(to, pattern) {
  const outbox = path.join(DATA_DIR, 'outbox');
  const needle = to.replace(/[^\w.@-]/g, '_');
  const files = fs.readdirSync(outbox).filter((name) => name.includes(needle)).sort();
  if (!files.length) throw new Error(`нет письма для ${to}`);
  const body = fs.readFileSync(path.join(outbox, files[files.length - 1]), 'utf8');
  const match = pattern.exec(body);
  if (!match) throw new Error(`в письме нет токена: ${body.slice(0, 200)}`);
  return match[1];
}

/** Registers a user and confirms the address, so the account can post right away. */
async function createVerifiedUser(client, prefix = 'user') {
  const username = `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.slice(0, 24);
  const email = `${username}@example.com`;
  const password = 'sup3rsecret';

  const res = await client.post('/api/auth/register', {
    username, email, password, displayName: `Канал ${prefix}`,
  });
  if (res.status !== 201) throw new Error(`регистрация не удалась: ${JSON.stringify(res.data)}`);

  const token = readTokenFromOutbox(email, /verify\?token=([\w-]+)/);
  await client.post('/api/auth/verify', { token });

  return { username, email, password, id: res.data.user.id };
}

module.exports = {
  BASE,
  DATA_DIR,
  createClient,
  hasFfmpeg,
  makeSampleVideo,
  uploadVideo,
  waitForStatus,
  readTokenFromOutbox,
  createVerifiedUser,
};
