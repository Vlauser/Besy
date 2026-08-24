/**
 * Protections a person has over their own account: blocking, reporting a whole
 * channel, taking their data out, and leaving.
 */
'use strict';

const assert = require('node:assert');

const { createClient, createVerifiedUser, makeSampleVideo, uploadVideo } = require('./lib/client');

let step = 'start';

(async function run() {
  const owner = createClient();
  await owner.get('/api/health');
  const ownerUser = await createVerifiedUser(owner, 'safeown');

  const pest = createClient();
  await pest.get('/api/health');
  const pestUser = await createVerifiedUser(pest, 'safepest');

  step = 'upload a video to comment on';
  const clip = makeSampleVideo();
  let res = await uploadVideo(owner, clip, { title: 'Видео для проверки блокировок' });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  const videoId = res.data.video.id;

  /* ---------------------------------------------------------- blocking */

  step = 'before a block a stranger may comment';
  res = await pest.post(`/api/videos/${videoId}/comments`, { body: 'Первый комментарий' });
  assert.equal(res.status, 201, JSON.stringify(res.data));

  step = 'block the account';
  res = await owner.post('/api/me/blocks', { username: pestUser.username });
  assert.equal(res.status, 201, JSON.stringify(res.data));

  step = 'a blocked account cannot comment';
  res = await pest.post(`/api/videos/${videoId}/comments`, { body: 'И ещё раз' });
  assert.equal(res.status, 403, 'the comment box must close for a blocked account');

  step = 'a blocked account cannot subscribe';
  res = await pest.post(`/api/channels/${ownerUser.username}/subscribe`, {});
  assert.equal(res.status, 403, 'a blocked account must not be able to subscribe');

  step = 'the block is listed';
  res = await owner.get('/api/me/blocks');
  assert.equal(res.status, 200);
  assert.ok(res.data.blocks.some((b) => b.username === pestUser.username), 'the block is missing');

  step = 'a block is private — the other side is not told';
  res = await pest.get('/api/me/blocks');
  assert.equal(res.data.blocks.length, 0, 'a block must not show up on the blocked side');

  step = 'you cannot block yourself';
  res = await owner.post('/api/me/blocks', { username: ownerUser.username });
  assert.equal(res.status, 400);

  step = 'unblocking restores contact';
  res = await owner.del(`/api/me/blocks/${pestUser.username}`);
  assert.equal(res.status, 200, JSON.stringify(res.data));
  res = await pest.post(`/api/videos/${videoId}/comments`, { body: 'Снова можно' });
  assert.equal(res.status, 201, 'unblocking must reopen the comment box');

  step = 'unblocking twice reports that nothing was blocked';
  res = await owner.del(`/api/me/blocks/${pestUser.username}`);
  assert.equal(res.status, 404);

  /* --------------------------------------------------------- reporting */

  step = 'report a whole channel';
  res = await pest.post('/api/moderation/reports', {
    targetType: 'user', username: ownerUser.username, reason: 'spam', details: 'Пример жалобы',
  });
  assert.equal(res.status, 201, JSON.stringify(res.data));

  step = 'the same channel report is refused twice';
  res = await pest.post('/api/moderation/reports', {
    targetType: 'user', username: ownerUser.username, reason: 'spam',
  });
  assert.equal(res.status, 409);

  step = 'you cannot report yourself';
  res = await pest.post('/api/moderation/reports', {
    targetType: 'user', username: pestUser.username, reason: 'spam',
  });
  assert.equal(res.status, 400);

  step = 'reporting a channel that does not exist';
  res = await pest.post('/api/moderation/reports', {
    targetType: 'user', username: 'нет-такого-канала', reason: 'spam',
  });
  assert.equal(res.status, 404);

  /* ------------------------------------------------------------ export */

  step = 'export my data';
  res = await owner.get('/api/me/export');
  assert.equal(res.status, 200, JSON.stringify(res.data));
  const dump = res.data;
  assert.equal(dump.account.username, ownerUser.username);
  assert.ok(dump.videos.some((v) => v.id === videoId), 'my video is missing from the export');
  assert.ok(Array.isArray(dump.sessions) && dump.sessions.length >= 1, 'sessions are missing');

  step = 'the export carries no credentials';
  const serialized = JSON.stringify(dump);
  for (const secret of ['password_hash', 'totp_secret', 'backup_codes', 'scrypt$']) {
    assert.ok(!serialized.includes(secret), `the export must not contain ${secret}`);
  }

  /* ---------------------------------------------------------- deletion */

  step = 'deleting an account needs the right password';
  res = await pest.del('/api/me/account', { password: 'не тот пароль' });
  assert.equal(res.status, 403, 'a wrong password must not delete the account');

  step = 'the account is still usable';
  res = await pest.get('/api/auth/me');
  assert.ok(res.data.user, 'a failed deletion must leave the session working');

  step = 'delete the account for real';
  res = await pest.del('/api/me/account', { password: pestUser.password });
  assert.equal(res.status, 200, JSON.stringify(res.data));

  step = 'the session dies with the account';
  res = await pest.get('/api/auth/me');
  assert.equal(res.data.user, null, 'the session must stop resolving to a user');

  step = 'and it no longer opens anything that needs an account';
  res = await pest.get('/api/me/blocks');
  assert.equal(res.status, 401, 'the deleted session must not reach an authenticated route');

  step = 'signing in again is impossible';
  const ghost = createClient();
  await ghost.get('/api/health');
  res = await ghost.post('/api/auth/login', {
    username: pestUser.username, password: pestUser.password,
  });
  assert.ok(res.status >= 400, 'a deleted account must not be able to sign in');

  step = 'the channel is gone';
  res = await ghost.get(`/api/channels/${pestUser.username}`);
  assert.equal(res.status, 404, 'the channel must disappear with the account');

  console.log('✅ Блокировки, жалобы на каналы, экспорт и удаление аккаунта проверены');
})().catch((err) => {
  console.error(`❌ Safety test failed on "${step}":`, err.message);
  process.exit(1);
});
