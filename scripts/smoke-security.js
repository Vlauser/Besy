/**
 * Security checks: CSRF, rate limits, brute-force lockout, 2FA, password
 * reset, session management, upload validation and the age gate.
 */
'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  BASE, createClient, createVerifiedUser, readTokenFromOutbox,
  makeSampleVideo, uploadVideo,
} = require('./lib/client');
const totp = require('../server/totp');

let step = 'start';

(async function run() {
  const client = createClient();

  step = 'security headers';
  let res = await client.get('/api/health');
  assert.match(res.headers.get('content-security-policy') || '', /default-src 'self'/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.ok(res.headers.get('referrer-policy'), 'Referrer-Policy missing');
  assert.ok(!res.headers.get('x-powered-by'), 'server should not advertise Express');

  step = 'CSRF cookie is issued';
  assert.ok(client.jar.get('besy_csrf'), 'CSRF cookie missing');

  step = 'state-changing request without the CSRF header is refused';
  let raw = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: client.cookieHeader() },
    body: JSON.stringify({ login: 'nobody', password: 'whatever' }),
  });
  assert.equal(raw.status, 403, 'missing CSRF header must be refused');

  step = 'CSRF header that does not match the cookie is refused';
  raw = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: client.cookieHeader(),
      'x-csrf-token': 'f'.repeat(64),
    },
    body: JSON.stringify({ login: 'nobody', password: 'whatever' }),
  });
  assert.equal(raw.status, 403, 'mismatched CSRF token must be refused');

  step = 'cross-origin request is refused';
  raw = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: client.cookieHeader(),
      'x-csrf-token': client.jar.get('besy_csrf'),
      origin: 'https://evil.example',
    },
    body: JSON.stringify({ login: 'nobody', password: 'whatever' }),
  });
  assert.equal(raw.status, 403, 'foreign Origin must be refused');

  step = 'weak passwords are rejected';
  res = await client.post('/api/auth/register', {
    username: `weak${Date.now().toString(36)}`.slice(0, 20),
    email: `weak${Date.now()}@example.com`,
    password: 'password',
  });
  assert.equal(res.status, 400, 'a dictionary password must be refused');

  const user = await createVerifiedUser(client, 'sec');

  step = 'password reset flow';
  const attacker = createClient();
  await attacker.get('/api/health');
  res = await attacker.post('/api/auth/password/forgot', { email: 'nobody@example.com' });
  assert.equal(res.status, 200, 'unknown addresses must not be distinguishable');

  res = await client.post('/api/auth/password/forgot', { email: user.email });
  assert.equal(res.status, 200);
  const resetToken = readTokenFromOutbox(user.email, /reset\?token=([\w-]+)/);

  res = await client.post('/api/auth/password/reset', { token: resetToken, password: 'short' });
  assert.equal(res.status, 400, 'weak new password must be refused');

  const newPassword = 'n3wStr0ngPass';
  res = await client.post('/api/auth/password/reset', { token: resetToken, password: newPassword });
  assert.equal(res.status, 200, JSON.stringify(res.data));

  step = 'reset token is single-use';
  res = await client.post('/api/auth/password/reset', { token: resetToken, password: 'another0ne!' });
  assert.equal(res.status, 400);

  step = 'reset invalidates old sessions';
  res = await client.get('/api/auth/me');
  assert.equal(res.data.user, null, 'sessions must be dropped after a password reset');

  step = 'login with the new password';
  res = await client.post('/api/auth/login', { login: user.username, password: newPassword });
  assert.equal(res.status, 200, JSON.stringify(res.data));

  step = 'rate limit headers';
  res = await client.get('/api/health');
  assert.ok(Number(res.headers.get('ratelimit-limit')) > 0, 'RateLimit-Limit missing');
  const firstRemaining = Number(res.headers.get('ratelimit-remaining'));
  res = await client.get('/api/health');
  assert.ok(Number(res.headers.get('ratelimit-remaining')) < firstRemaining, 'budget must decrease');

  // Lockout is keyed by login+IP, so use a throwaway login: locking the real
  // account here would (correctly) block the rest of this run.
  step = 'brute-force lockout';
  const bruteforce = createClient();
  await bruteforce.get('/api/health');
  const victim = `victim_${Date.now().toString(36)}`;
  let locked = null;
  for (let i = 0; i < 8; i += 1) {
    const attempt = await bruteforce.post('/api/auth/login', {
      login: victim, password: `wrong-${i}`,
    });
    if (attempt.status === 429) { locked = attempt; break; }
  }
  assert.ok(locked, 'repeated failures must lock the account out');
  assert.match(locked.data.error, /неудачных попыток/i, 'expected the lockout message, not a generic limit');
  assert.ok(Number(locked.headers.get('retry-after')) > 0, 'Retry-After missing');

  step = 'lockout does not block the already signed-in session';
  res = await client.get('/api/auth/me');
  assert.equal(res.data.user.username, user.username);

  step = '2FA setup';
  res = await client.post('/api/auth/2fa/setup');
  assert.equal(res.status, 200);
  const secret = res.data.secret;
  assert.ok(secret && secret.length >= 16, 'TOTP secret missing');
  assert.match(res.data.qr, /^data:image\/png;base64,/, 'QR code missing');
  assert.match(res.data.otpauthUrl, /^otpauth:\/\/totp\//);

  step = '2FA rejects a wrong code';
  res = await client.post('/api/auth/2fa/enable', { code: '000000' });
  assert.equal(res.status, 400);

  step = '2FA enable';
  res = await client.post('/api/auth/2fa/enable', {
    code: totp.generateCode(secret, Math.floor(Date.now() / 1000 / 30)),
  });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  const backupCodes = res.data.backupCodes;
  assert.equal(backupCodes.length, 10, 'backup codes missing');

  step = 'login now demands the second factor';
  const second = createClient();
  await second.get('/api/health');
  res = await second.post('/api/auth/login', { login: user.username, password: newPassword });
  assert.equal(res.status, 401);
  assert.equal(res.data.twoFactorRequired, true);

  step = 'login with a TOTP code';
  res = await second.post('/api/auth/login', {
    login: user.username,
    password: newPassword,
    code: totp.generateCode(secret, Math.floor(Date.now() / 1000 / 30)),
  });
  assert.equal(res.status, 200, JSON.stringify(res.data));

  step = 'a backup code works once';
  const third = createClient();
  await third.get('/api/health');
  res = await third.post('/api/auth/login', {
    login: user.username, password: newPassword, code: backupCodes[0],
  });
  assert.equal(res.status, 200, JSON.stringify(res.data));

  res = await third.post('/api/auth/login', {
    login: user.username, password: newPassword, code: backupCodes[0],
  });
  assert.equal(res.status, 401, 'a spent backup code must not work again');

  step = 'session list and revocation';
  res = await client.get('/api/auth/sessions');
  assert.ok(res.data.sessions.length >= 2, 'expected several active sessions');
  assert.equal(res.data.sessions.filter((s) => s.current).length, 1);

  res = await client.post('/api/auth/sessions/revoke-others');
  assert.equal(res.status, 200);
  assert.ok(res.data.revoked >= 1);

  res = await second.get('/api/auth/me');
  assert.equal(res.data.user, null, 'the revoked session must be dead');

  step = '2FA off again';
  res = await client.post('/api/auth/2fa/disable', { password: 'not-the-password' });
  assert.equal(res.status, 401);
  res = await client.post('/api/auth/2fa/disable', { password: newPassword });
  assert.equal(res.status, 200);

  step = 'uploads are checked by content, not by name';
  const fake = path.join(os.tmpdir(), `besy-fake-${Date.now()}.mp4`);
  fs.writeFileSync(fake, Buffer.concat([Buffer.from('#!/bin/sh\necho pwned\n'), Buffer.alloc(2048, 0x41)]));
  res = await uploadVideo(client, fake, { title: 'Не видео' });
  assert.equal(res.status, 415, 'a script renamed to .mp4 must be refused');
  fs.rmSync(fake, { force: true });

  step = 'age-restricted video needs a signed-in viewer';
  const clip = makeSampleVideo();
  res = await uploadVideo(client, clip, { title: 'Только 18+', ageRestricted: 'true' });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  const adultId = res.data.video.id;
  assert.equal(res.data.video.ageRestricted, true);

  const anonymous = createClient();
  await anonymous.get('/api/health');
  res = await anonymous.get(`/api/videos/${adultId}`);
  assert.equal(res.status, 403);
  assert.equal(res.data.ageRestricted, true);

  let media = await anonymous.fetchRaw(`/media/stream/${adultId}`);
  assert.equal(media.status, 403, 'the stream itself must respect the age gate');

  res = await client.get(`/api/videos/${adultId}`);
  assert.equal(res.status, 200, 'the owner can always open their own video');

  step = 'comment antispam';
  const commenter = createClient();
  await commenter.get('/api/health');
  const commenterUser = await createVerifiedUser(commenter, 'spam');

  const openClip = makeSampleVideo();
  res = await uploadVideo(client, openClip, { title: 'Открытое видео' });
  const openId = res.data.video.id;

  res = await commenter.post(`/api/videos/${openId}/comments`, { body: 'Хороший ролик' });
  assert.equal(res.status, 201);

  res = await commenter.post(`/api/videos/${openId}/comments`, { body: 'Хороший ролик' });
  assert.equal(res.status, 429, 'a duplicate comment must be refused');

  res = await commenter.post(`/api/videos/${openId}/comments`, {
    body: 'смотри http://a.example http://b.example http://c.example',
  });
  assert.equal(res.status, 429, 'link flood must be refused');

  res = await commenter.post(`/api/videos/${openId}/comments`, {
    body: 'КУПИТЕ ЭТО ПРЯМО СЕЙЧАС ОЧЕНЬ ВЫГОДНО',
  });
  assert.equal(res.status, 429, 'all-caps comment must be refused');

  step = 'unverified accounts cannot comment';
  const fresh = createClient();
  await fresh.get('/api/health');
  const freshName = `nv_${Date.now().toString(36)}`.slice(0, 20);
  await fresh.post('/api/auth/register', {
    username: freshName, email: `${freshName}@example.com`, password: 'sup3rsecret',
  });
  res = await fresh.post(`/api/videos/${openId}/comments`, { body: 'Привет' });
  assert.equal(res.status, 403);
  assert.equal(res.data.needsEmailVerification, true);

  step = 'cleanup';
  await client.del(`/api/videos/${adultId}`);
  await client.del(`/api/videos/${openId}`);
  fs.rmSync(clip, { force: true });
  fs.rmSync(openClip, { force: true });

  console.log('✅ Проверки безопасности пройдены');
})().catch((err) => {
  console.error(`❌ Security test failed on "${step}":`, err.message);
  process.exit(1);
});
