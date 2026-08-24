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
  // The field is `login`, not `username`: sending the wrong one fails for the
  // wrong reason and the assertion would pass on any account.
  res = await ghost.post('/api/auth/login', {
    login: pestUser.username, password: pestUser.password,
  });
  assert.equal(res.status, 401, 'a deleted account must not be able to sign in');

  step = 'the channel is gone';
  res = await ghost.get(`/api/channels/${pestUser.username}`);
  assert.equal(res.status, 404, 'the channel must disappear with the account');

  /* ---------------------------------------------------------- artwork */

  const PNG = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(64, 0x11),
  ]);

  async function putArtwork(client, kind, buffer, filename = 'art.png', type = 'image/png') {
    const form = new FormData();
    form.append('image', new Blob([buffer], { type }), filename);
    return client.call('POST', `/api/branding/${kind}`, form, true);
  }

  step = 'no artwork before anything is uploaded';
  res = await owner.get(`/api/channels/${ownerUser.username}`);
  assert.equal(res.data.channel.avatar, null);
  assert.equal(res.data.channel.banner, null);

  step = 'upload an avatar and a banner';
  for (const kind of ['avatar', 'banner']) {
    res = await putArtwork(owner, kind, PNG);
    assert.equal(res.status, 201, `${kind}: ${JSON.stringify(res.data)}`);
  }

  step = 'the channel now reports both';
  res = await owner.get(`/api/channels/${ownerUser.username}`);
  assert.ok(res.data.channel.avatar, 'avatar missing from the channel');
  assert.ok(res.data.channel.banner, 'banner missing from the channel');

  step = 'artwork is public — a signed-out visitor sees it';
  const stranger = createClient();
  await stranger.get('/api/health');
  for (const kind of ['avatar', 'banner']) {
    const raw = await stranger.fetchRaw(`/media/${kind}/${ownerUser.username}`);
    assert.equal(raw.status, 200, `${kind} must be readable`);
    assert.equal(raw.headers.get('content-type'), 'image/png', `${kind} content type`);
  }

  step = 'the avatar rides along with the video author';
  res = await stranger.get(`/api/videos/${videoId}`);
  assert.ok(res.data.video.author.avatar, 'author avatar missing');

  step = 'a file that is not an image is refused';
  res = await putArtwork(owner, 'avatar', Buffer.from('<svg onload=alert(1)>'), 'x.png');
  assert.equal(res.status, 400, 'content type is sniffed, not trusted');

  step = 'strangers cannot set artwork for someone else';
  // There is no path that names a target user — branding always writes to the
  // caller — so the check is that signing out closes it entirely.
  res = await putArtwork(stranger, 'avatar', PNG);
  assert.equal(res.status, 401);

  step = 'remove the avatar';
  res = await owner.del('/api/branding/avatar');
  assert.equal(res.status, 200, JSON.stringify(res.data));
  res = await owner.get(`/api/channels/${ownerUser.username}`);
  assert.equal(res.data.channel.avatar, null, 'avatar should be gone');
  assert.ok(res.data.channel.banner, 'removing the avatar must not touch the banner');

  step = 'removing it twice reports that there is nothing to remove';
  res = await owner.del('/api/branding/avatar');
  assert.equal(res.status, 404);

  /* ----------------------------------------------------------- handle */

  step = 'a bad handle is refused';
  for (const bad of ['ab', 'с-кириллицей', 'a'.repeat(25), 'has space']) {
    res = await owner.post('/api/auth/me/username', { username: bad });
    assert.equal(res.status, 400, `«${bad}» must be refused`);
  }

  step = 'a handle in use is refused';
  const rival = createClient();
  await rival.get('/api/health');
  const rivalUser = await createVerifiedUser(rival, 'rival');
  res = await owner.post('/api/auth/me/username', { username: rivalUser.username });
  assert.equal(res.status, 409);

  step = 'change the handle';
  const newHandle = `${ownerUser.username}_2`.slice(0, 24);
  res = await owner.post('/api/auth/me/username', { username: newHandle });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal(res.data.user.username, newHandle);
  assert.equal(res.data.previous, ownerUser.username);

  step = 'the channel answers on the new handle';
  res = await owner.get(`/api/channels/${newHandle}`);
  assert.equal(res.status, 200);

  step = 'and the old handle stops resolving';
  res = await owner.get(`/api/channels/${ownerUser.username}`);
  assert.equal(res.status, 404, 'a released handle must not still point at the channel');

  step = 'the released handle is free for anyone';
  res = await rival.post('/api/auth/me/username', { username: ownerUser.username });
  assert.equal(res.status, 200, 'a released handle goes back into the pool');
  assert.equal(res.data.user.username, ownerUser.username);

  step = 'changing again is refused until the cooldown passes';
  res = await owner.post('/api/auth/me/username', { username: `${newHandle}x`.slice(0, 24) });
  assert.equal(res.status, 429);

  step = 'artwork follows the new handle';
  const rawArt = await owner.fetchRaw(`/media/banner/${newHandle}`);
  assert.equal(rawArt.status, 200, 'the banner must answer on the current handle');

  console.log('✅ Блокировки, жалобы, экспорт, удаление аккаунта, оформление и смена логина проверены');
})().catch((err) => {
  console.error(`❌ Safety test failed on "${step}":`, err.message);
  process.exit(1);
});
