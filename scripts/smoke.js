/**
 * End-to-end smoke test against a running Besy instance.
 * Usage: node --experimental-sqlite server/index.js &  &&  node scripts/smoke.js
 */
'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const BASE = process.env.BESY_URL || 'http://127.0.0.1:3000';
let cookie = '';

async function call(method, url, body, raw = false) {
  const init = { method, headers: { cookie }, redirect: 'manual' };
  if (body !== undefined && !raw) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  } else if (raw) {
    init.body = body;
  }
  const res = await fetch(BASE + url, init);
  const setCookie = res.headers.getSetCookie?.() || [];
  for (const c of setCookie) cookie = c.split(';')[0];
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  return { status: res.status, data, headers: res.headers };
}

function makeSampleVideo() {
  // A tiny but structurally valid file is enough: the server never decodes it.
  const file = path.join(os.tmpdir(), `besy-sample-${Date.now()}.mp4`);
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmp42'),
    Buffer.alloc(1024 * 64, 0x21),
  ]));
  return file;
}

(async function run() {
  const suffix = Date.now().toString(36);
  const username = `tester_${suffix}`.slice(0, 24);

  let step = 'health';
  const health = await call('GET', '/api/health');
  assert.equal(health.status, 200, 'health check failed');

  step = 'register';
  let res = await call('POST', '/api/auth/register', {
    username, email: `${username}@example.com`, password: 'sup3rsecret', displayName: 'Тестовый канал',
  });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  assert.equal(res.data.user.username, username);

  step = 'register rejects weak password';
  res = await call('POST', '/api/auth/register', { username: `x${suffix}`, email: `x${suffix}@e.com`, password: 'short' });
  assert.equal(res.status, 400);

  step = 'me';
  res = await call('GET', '/api/auth/me');
  assert.equal(res.data.user.username, username);

  step = 'upload';
  const sample = makeSampleVideo();
  const form = new FormData();
  form.append('video', new Blob([fs.readFileSync(sample)], { type: 'video/mp4' }), 'sample.mp4');
  form.append('thumbnail', new Blob([Buffer.from('\xff\xd8\xff', 'binary')], { type: 'image/jpeg' }), 'thumb.jpg');
  form.append('title', 'Первое видео на Besy');
  form.append('description', 'Описание тестового видео');
  form.append('tags', 'тест, demo');
  form.append('visibility', 'public');
  form.append('duration', '12.5');
  form.append('width', '1920');
  form.append('height', '1080');
  res = await call('POST', '/api/videos', form, true);
  assert.equal(res.status, 201, JSON.stringify(res.data));
  const videoId = res.data.video.id;
  assert.equal(res.data.video.tags.join(','), 'тест,demo');

  step = 'listing';
  res = await call('GET', '/api/videos?sort=new');
  assert.ok(res.data.videos.some((v) => v.id === videoId), 'uploaded video missing from feed');

  step = 'search';
  res = await call('GET', '/api/videos?q=' + encodeURIComponent('Первое'));
  assert.ok(res.data.videos.some((v) => v.id === videoId), 'search did not find the video');

  step = 'detail';
  res = await call('GET', `/api/videos/${videoId}`);
  assert.equal(res.data.video.title, 'Первое видео на Besy');
  assert.equal(res.data.video.isOwner, true);

  step = 'view counter';
  res = await call('POST', `/api/videos/${videoId}/view`);
  assert.equal(res.data.views, 1);
  res = await call('POST', `/api/videos/${videoId}/view`);
  assert.equal(res.data.views, 1, 'repeat view within cooldown must not count');

  step = 'reactions';
  res = await call('POST', `/api/videos/${videoId}/reaction`, { value: 1 });
  assert.equal(res.data.likes, 1);
  res = await call('POST', `/api/videos/${videoId}/reaction`, { value: -1 });
  assert.equal(res.data.likes, 0);
  assert.equal(res.data.dislikes, 1);
  res = await call('POST', `/api/videos/${videoId}/reaction`, { value: 0 });
  assert.equal(res.data.dislikes, 0);

  step = 'comments';
  res = await call('POST', `/api/videos/${videoId}/comments`, { body: 'Отличное видео!' });
  assert.equal(res.status, 201);
  const commentId = res.data.comment.id;
  res = await call('GET', `/api/videos/${videoId}/comments`);
  assert.equal(res.data.comments.length, 1);
  res = await call('DELETE', `/api/videos/${videoId}/comments/${commentId}`);
  assert.equal(res.status, 200);

  step = 'range streaming';
  let stream = await fetch(`${BASE}/media/stream/${videoId}`, { headers: { cookie, range: 'bytes=0-99' } });
  assert.equal(stream.status, 206, 'expected partial content');
  assert.equal(stream.headers.get('content-length'), '100');
  assert.match(stream.headers.get('content-range'), /^bytes 0-99\/\d+$/);

  stream = await fetch(`${BASE}/media/stream/${videoId}`, { headers: { cookie, range: 'bytes=-50' } });
  assert.equal(stream.status, 206, 'suffix range must work');
  assert.equal(stream.headers.get('content-length'), '50');

  stream = await fetch(`${BASE}/media/stream/${videoId}`, { headers: { cookie, range: 'bytes=999999999-' } });
  assert.equal(stream.status, 416, 'out-of-range must return 416');

  stream = await fetch(`${BASE}/media/stream/${videoId}`, { headers: { cookie } });
  assert.equal(stream.status, 200);
  assert.equal(stream.headers.get('accept-ranges'), 'bytes');

  step = 'thumbnail';
  const thumb = await fetch(`${BASE}/media/thumb/${videoId}`, { headers: { cookie } });
  assert.equal(thumb.status, 200);

  step = 'channel page';
  res = await call('GET', `/api/channels/${username}`);
  assert.equal(res.data.channel.videos, 1);
  assert.equal(res.data.channel.isOwner, true);

  step = 'privacy';
  res = await call('PATCH', `/api/videos/${videoId}`, { visibility: 'private' });
  assert.equal(res.data.video.visibility, 'private');
  const ownerCookie = cookie;

  cookie = ''; // anonymous visitor
  res = await call('GET', `/api/videos/${videoId}`);
  assert.equal(res.status, 403, 'private video must not be readable by strangers');
  const anonStream = await fetch(`${BASE}/media/stream/${videoId}`);
  assert.equal(anonStream.status, 403, 'private stream must not be readable by strangers');
  res = await call('GET', '/api/videos');
  assert.ok(!res.data.videos.some((v) => v.id === videoId), 'private video must not appear in the public feed');
  res = await call('POST', '/api/videos', {});
  assert.equal(res.status, 401, 'anonymous upload must be rejected');

  step = 'second user cannot edit';
  const other = `other_${suffix}`.slice(0, 24);
  await call('POST', '/api/auth/register', { username: other, email: `${other}@example.com`, password: 'sup3rsecret' });
  res = await call('DELETE', `/api/videos/${videoId}`);
  assert.equal(res.status, 403, 'strangers must not delete other people videos');

  step = 'subscriptions';
  res = await call('POST', `/api/channels/${username}/subscribe`);
  assert.equal(res.data.subscribed, true);
  assert.equal(res.data.subscribers, 1);
  res = await call('POST', `/api/channels/${username}/subscribe`);
  assert.equal(res.data.subscribed, false, 'second call must unsubscribe');

  step = 'login flow';
  cookie = '';
  res = await call('POST', '/api/auth/login', { login: username, password: 'wrong-password' });
  assert.equal(res.status, 401);
  res = await call('POST', '/api/auth/login', { login: username, password: 'sup3rsecret' });
  assert.equal(res.status, 200);

  step = 'owner deletes own video';
  res = await call('DELETE', `/api/videos/${videoId}`);
  assert.equal(res.status, 200);
  res = await call('GET', `/api/videos/${videoId}`);
  assert.equal(res.status, 404);

  step = 'logout';
  res = await call('POST', '/api/auth/logout');
  assert.equal(res.status, 200);
  cookie = '';
  res = await call('GET', '/api/auth/me');
  assert.equal(res.data.user, null);

  step = 'pages render';
  for (const page of ['/', '/upload', '/auth', '/studio', `/@${username}`, '/watch/whatever']) {
    const page_res = await fetch(BASE + page);
    assert.equal(page_res.status, 200, `page ${page} returned ${page_res.status}`);
    assert.match(await page_res.text(), /<\/html>/, `page ${page} is not html`);
  }

  fs.rmSync(sample, { force: true });
  console.log('✅ Все проверки пройдены');
})().catch((err) => {
  console.error('❌ Smoke test failed:', err.message);
  process.exit(1);
});
