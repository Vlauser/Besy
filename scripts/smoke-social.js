/**
 * Playlists and moderation: CRUD and ordering, reports, strikes, blocking,
 * copyright claims, bans and the audit log.
 */
'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const {
  DATA_DIR, createClient, createVerifiedUser, makeSampleVideo, uploadVideo,
} = require('./lib/client');

let step = 'start';

function promoteToAdmin(username) {
  execFileSync(process.execPath, [
    '--experimental-sqlite', path.join(__dirname, 'make-admin.js'), username,
  ], { stdio: 'ignore', env: { ...process.env, BESY_DATA_DIR: DATA_DIR } });
}

(async function run() {
  const author = createClient();
  await author.get('/api/health');
  const authorUser = await createVerifiedUser(author, 'author');

  const clips = [];
  const videoIds = [];
  step = 'seed videos';
  for (const title of ['Первое', 'Второе', 'Третье']) {
    const clip = makeSampleVideo();
    clips.push(clip);
    const res = await uploadVideo(author, clip, { title });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    videoIds.push(res.data.video.id);
  }

  /* ---------------------------------------------------------- playlists */

  step = 'create a playlist';
  let res = await author.post('/api/playlists', {
    title: 'Мой сборник',
    description: 'Лучшее',
    visibility: 'public',
    videoId: videoIds[0],
  });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  const playlistId = res.data.playlist.id;
  assert.equal(res.data.playlist.count, 1, 'the seeding video should already be inside');

  step = 'add items';
  res = await author.post(`/api/playlists/${playlistId}/items`, { videoId: videoIds[1] });
  assert.equal(res.status, 201);
  res = await author.post(`/api/playlists/${playlistId}/items`, { videoId: videoIds[2] });
  assert.equal(res.status, 201);

  step = 'duplicates are refused';
  res = await author.post(`/api/playlists/${playlistId}/items`, { videoId: videoIds[1] });
  assert.equal(res.status, 409);

  step = 'playlist contents keep their order';
  res = await author.get(`/api/playlists/${playlistId}`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.data.videos.map((v) => v.id), videoIds);
  assert.equal(res.data.isOwner, true);

  step = 'reorder';
  const reversed = [...videoIds].reverse();
  res = await author.post(`/api/playlists/${playlistId}/reorder`, { order: reversed });
  assert.equal(res.status, 200);
  res = await author.get(`/api/playlists/${playlistId}`);
  assert.deepEqual(res.data.videos.map((v) => v.id), reversed);

  step = 'a bogus order is refused';
  res = await author.post(`/api/playlists/${playlistId}/reorder`, { order: ['nope'] });
  assert.equal(res.status, 400);

  step = 'remove an item';
  res = await author.del(`/api/playlists/${playlistId}/items/${videoIds[0]}`);
  assert.equal(res.status, 200);
  res = await author.get(`/api/playlists/${playlistId}`);
  assert.equal(res.data.videos.length, 2);

  step = 'membership flags for the add-to-playlist menu';
  res = await author.get(`/api/playlists/mine?videoId=${videoIds[1]}`);
  assert.equal(res.data.playlists.find((p) => p.id === playlistId).contains, true);
  res = await author.get(`/api/playlists/mine?videoId=${videoIds[0]}`);
  assert.equal(res.data.playlists.find((p) => p.id === playlistId).contains, false);

  const stranger = createClient();
  await stranger.get('/api/health');

  step = 'a public playlist is visible to everyone';
  res = await stranger.get(`/api/playlists/${playlistId}`);
  assert.equal(res.status, 200);
  assert.equal(res.data.isOwner, false);

  step = 'strangers cannot edit a playlist';
  const strangerUser = await createVerifiedUser(stranger, 'stranger');
  res = await stranger.post(`/api/playlists/${playlistId}/items`, { videoId: videoIds[0] });
  assert.equal(res.status, 403);
  res = await stranger.del(`/api/playlists/${playlistId}`);
  assert.equal(res.status, 403);

  step = 'private playlists are hidden';
  res = await author.patch(`/api/playlists/${playlistId}`, { visibility: 'private' });
  assert.equal(res.data.playlist.visibility, 'private');
  res = await stranger.get(`/api/playlists/${playlistId}`);
  assert.equal(res.status, 403);
  res = await stranger.get(`/api/playlists?channel=${authorUser.username}`);
  assert.equal(res.data.playlists.length, 0, 'a private playlist must not be listed');

  await author.patch(`/api/playlists/${playlistId}`, { visibility: 'public' });

  /* --------------------------------------------------------- moderation */

  step = 'reporting';
  res = await stranger.post('/api/moderation/reports', {
    targetType: 'video', videoId: videoIds[1], reason: 'spam', details: 'Похоже на рекламу',
  });
  assert.equal(res.status, 201, JSON.stringify(res.data));

  res = await stranger.post('/api/moderation/reports', {
    targetType: 'video', videoId: videoIds[1], reason: 'spam',
  });
  assert.equal(res.status, 409, 'a repeat report must be refused');

  step = 'the moderation queue needs rights';
  res = await stranger.get('/api/moderation/reports');
  assert.equal(res.status, 403);

  step = 'promote a moderator';
  const admin = createClient();
  await admin.get('/api/health');
  const adminUser = await createVerifiedUser(admin, 'mod');
  promoteToAdmin(adminUser.username);
  await admin.post('/api/auth/login', { login: adminUser.username, password: adminUser.password });
  res = await admin.get('/api/auth/me');
  assert.equal(res.data.user.isAdmin, true, 'the CLI should have granted rights');

  step = 'the queue lists the report';
  res = await admin.get('/api/moderation/reports');
  assert.equal(res.status, 200);
  const report = res.data.reports.find((r) => r.videoId === videoIds[1]);
  assert.ok(report, 'the report is missing from the queue');
  assert.equal(report.reasonLabel, 'Спам или мошенничество');

  step = 'blocking a video with a strike';
  res = await admin.post(`/api/moderation/videos/${videoIds[1]}/block`, {
    reason: 'Спам', strike: true,
  });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal(res.data.strikes, 1);

  step = 'a blocked video disappears for viewers';
  res = await stranger.get(`/api/videos/${videoIds[1]}`);
  assert.equal(res.status, 451);
  let media = await stranger.fetchRaw(`/media/stream/${videoIds[1]}`);
  assert.equal(media.status, 451, 'the stream must be blocked too');

  res = await stranger.get('/api/videos');
  assert.ok(!res.data.videos.some((v) => v.id === videoIds[1]), 'blocked videos must leave the feed');

  step = 'the owner still sees why it was blocked';
  res = await author.get(`/api/videos/${videoIds[1]}`);
  assert.equal(res.status, 200);
  assert.equal(res.data.video.blocked, true);
  assert.equal(res.data.video.blockedReason, 'Спам');

  step = 'the author can see their strikes';
  res = await author.get(`/api/moderation/users/${authorUser.username}/strikes`);
  assert.equal(res.status, 200);
  assert.equal(res.data.active, 1);
  assert.equal(res.data.strikes[0].reason, 'Спам');

  step = 'other people cannot read someone else strikes';
  res = await stranger.get(`/api/moderation/users/${authorUser.username}/strikes`);
  assert.equal(res.status, 403);

  step = 'resolving the report';
  res = await admin.post(`/api/moderation/reports/${report.id}/resolve`, {
    status: 'resolved', resolution: 'Видео заблокировано',
  });
  assert.equal(res.status, 200);
  res = await admin.get('/api/moderation/reports');
  assert.ok(!res.data.reports.some((r) => r.id === report.id), 'the report should leave the open queue');

  step = 'unblocking';
  res = await admin.post(`/api/moderation/videos/${videoIds[1]}/unblock`);
  assert.equal(res.status, 200);
  res = await stranger.get(`/api/videos/${videoIds[1]}`);
  assert.equal(res.status, 200);

  step = 'age restriction by a moderator';
  res = await admin.post(`/api/moderation/videos/${videoIds[2]}/age-restrict`, { restricted: true });
  assert.equal(res.data.ageRestricted, true);
  const anonymous = createClient();
  await anonymous.get('/api/health');
  res = await anonymous.get(`/api/videos/${videoIds[2]}`);
  assert.equal(res.status, 403);
  await admin.post(`/api/moderation/videos/${videoIds[2]}/age-restrict`, { restricted: false });

  step = 'copyright claim';
  res = await stranger.post('/api/moderation/copyright', {
    videoId: videoIds[0], work: 'Мой трек «Besy»', statement: 'Использовано без разрешения',
    claimantName: 'Иван Иванов', claimantEmail: 'ivan@example.com', confirmed: true,
  });
  assert.equal(res.status, 201, JSON.stringify(res.data));

  res = await stranger.post('/api/moderation/copyright', {
    videoId: videoIds[0], work: 'X', statement: 'Y',
    claimantName: 'Z', claimantEmail: 'z@example.com',
  });
  assert.equal(res.status, 400, 'an unconfirmed claim must be refused');

  step = 'accepting a claim blocks the video and adds a strike';
  res = await admin.get('/api/moderation/copyright');
  const claim = res.data.claims[0];
  assert.ok(claim, 'the claim is missing');
  res = await admin.post(`/api/moderation/copyright/${claim.id}/resolve`, {
    status: 'accepted', resolution: 'Подтверждено',
  });
  assert.equal(res.status, 200);

  res = await author.get(`/api/videos/${videoIds[0]}`);
  assert.equal(res.data.video.blocked, true);
  res = await author.get(`/api/moderation/users/${authorUser.username}/strikes`);
  assert.equal(res.data.active, 2, 'the copyright strike should be counted');

  step = 'the third strike bans the account';
  res = await admin.post(`/api/moderation/videos/${videoIds[2]}/block`, {
    reason: 'Повторное нарушение', strike: true,
  });
  assert.equal(res.data.strikes, 3);

  res = await author.get('/api/auth/me');
  assert.equal(res.data.user, null, 'the ban must kill active sessions');

  const banned = createClient();
  await banned.get('/api/health');
  res = await banned.post('/api/auth/login', {
    login: authorUser.username, password: authorUser.password,
  });
  assert.equal(res.status, 403, 'a banned account must not be able to sign in');

  step = 'unbanning clears the strikes';
  res = await admin.post(`/api/moderation/users/${authorUser.username}/unban`);
  assert.equal(res.status, 200);
  res = await banned.post('/api/auth/login', {
    login: authorUser.username, password: authorUser.password,
  });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  res = await banned.get(`/api/moderation/users/${authorUser.username}/strikes`);
  assert.equal(res.data.active, 0);

  step = 'moderators cannot be banned';
  res = await admin.post(`/api/moderation/users/${adminUser.username}/ban`, { reason: 'test' });
  assert.equal(res.status, 403);

  step = 'audit log';
  res = await admin.get('/api/moderation/log');
  assert.equal(res.status, 200);
  const actions = res.data.entries.map((entry) => entry.action);
  for (const expected of ['block_video', 'unblock_video', 'copyright_accepted', 'auto_ban', 'unban_user']) {
    assert.ok(actions.includes(expected), `audit log is missing ${expected}`);
  }
  assert.ok(res.data.entries.every((entry) => entry.actor), 'every entry needs an actor');

  step = 'moderation stats';
  res = await admin.get('/api/moderation/stats');
  assert.ok(res.data.users >= 3);
  assert.ok(res.data.videos >= 3);

  step = 'cleanup';
  await admin.del(`/api/moderation/videos/${videoIds[0]}`);
  for (const id of videoIds.slice(1)) await banned.del(`/api/videos/${id}`);
  await banned.del(`/api/playlists/${playlistId}`);
  for (const clip of clips) fs.rmSync(clip, { force: true });

  console.log('✅ Плейлисты и модерация проверены');
})().catch((err) => {
  console.error(`❌ Social test failed on "${step}":`, err.message);
  process.exit(1);
});
