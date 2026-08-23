/**
 * Studio analytics and the growth surfaces: heartbeats, retention, traffic
 * sources, notifications, history, Watch Later, recommendations, community
 * posts and scheduled publishing.
 */
'use strict';

const assert = require('node:assert');
const fs = require('node:fs');

const { createClient, createVerifiedUser, makeSampleVideo, uploadVideo } = require('./lib/client');

let step = 'start';

(async function run() {
  const creator = createClient();
  await creator.get('/api/health');
  const creatorUser = await createVerifiedUser(creator, 'growth');

  const viewer = createClient();
  await viewer.get('/api/health');
  const viewerUser = await createVerifiedUser(viewer, 'fan');

  const clip = makeSampleVideo();
  step = 'upload';
  let res = await uploadVideo(creator, clip, { title: 'Ролик для статистики', tags: 'котики, обзор' });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  const videoId = res.data.video.id;

  /* ------------------------------------------------------------ analytics */

  step = 'a view is attributed to a traffic source';
  res = await viewer.post(`/api/videos/${videoId}/view`, { source: 'search' });
  assert.equal(res.status, 200);
  assert.equal(res.data.views, 1);

  step = 'heartbeats accumulate watch time';
  for (const position of [5, 20, 40]) {
    res = await viewer.post(`/api/videos/${videoId}/heartbeat`, {
      seconds: 15, position, duration: 60,
    });
    assert.equal(res.status, 200);
  }

  step = 'a heartbeat cannot inflate watch time';
  res = await viewer.post(`/api/videos/${videoId}/heartbeat`, {
    seconds: 100000, position: 50, duration: 60,
  });
  assert.equal(res.status, 200);

  step = 'video analytics';
  res = await creator.get(`/api/analytics/video/${videoId}?days=7`);
  assert.equal(res.status, 200, JSON.stringify(res.data));
  const analytics = res.data;
  assert.equal(analytics.video.views, 1);
  assert.ok(analytics.video.watchSeconds >= 45, `watch time is too low: ${analytics.video.watchSeconds}`);
  assert.ok(analytics.video.watchSeconds <= 145, `one heartbeat is capped at 60s, got ${analytics.video.watchSeconds}`);
  assert.equal(analytics.series.length, 7, 'the series must span the whole window');
  assert.equal(analytics.series[analytics.series.length - 1].views, 1, 'today should hold the view');
  assert.equal(analytics.retention.length, 20);
  assert.equal(analytics.retention[0].value, 100, 'the first bucket is the 100% baseline');
  for (let i = 1; i < analytics.retention.length; i += 1) {
    assert.ok(
      analytics.retention[i].value <= analytics.retention[i - 1].value,
      `retention must never rise: ${analytics.retention[i - 1].value} -> ${analytics.retention[i].value}`
    );
  }
  assert.ok(analytics.retention[13].value > 0, 'a viewer who reached 66% should show there');
  assert.equal(analytics.retention[19].value, 0, 'nobody reached the end in this run');
  assert.deepEqual(analytics.sources.map((s) => s.id), ['search']);
  assert.equal(analytics.sources[0].label, 'Поиск');

  step = 'analytics are private to the owner';
  res = await viewer.get(`/api/analytics/video/${videoId}`);
  assert.equal(res.status, 403);

  step = 'channel analytics';
  res = await creator.get('/api/analytics/channel?days=28');
  assert.equal(res.data.totals.views, 1);
  assert.ok(res.data.totals.watchSeconds >= 45);
  assert.equal(res.data.series.length, 28);
  assert.ok(res.data.top.some((v) => v.id === videoId));

  /* -------------------------------------------------------------- history */

  step = 'watching writes history';
  res = await viewer.get('/api/me/history');
  const entry = res.data.history.find((row) => row.id === videoId);
  assert.ok(entry, 'the video is missing from the history');
  assert.ok(entry.position >= 40, `position was not stored: ${entry.position}`);

  step = 'history can be cleaned up';
  res = await viewer.del(`/api/me/history?videoId=${videoId}`);
  assert.equal(res.status, 200);
  res = await viewer.get('/api/me/history');
  assert.ok(!res.data.history.some((row) => row.id === videoId));

  /* ---------------------------------------------------------- watch later */

  step = 'watch later toggles';
  res = await viewer.post('/api/me/watch-later', { videoId });
  assert.equal(res.data.added, true);
  res = await viewer.get('/api/me/watch-later');
  assert.ok(res.data.videos.some((v) => v.id === videoId));

  res = await viewer.post('/api/me/watch-later', { videoId });
  assert.equal(res.data.added, false, 'a second call should remove it');
  res = await viewer.get('/api/me/watch-later');
  assert.equal(res.data.videos.length, 0);

  step = 'watch later stays out of the public playlist list';
  res = await viewer.get(`/api/playlists?channel=${viewerUser.username}`);
  assert.ok(!res.data.playlists.some((p) => p.title === 'Смотреть позже'));
  res = await viewer.get('/api/playlists/mine');
  assert.ok(!res.data.playlists.some((p) => p.title === 'Смотреть позже'));

  /* -------------------------------------------------------- notifications */

  step = 'subscribing then publishing notifies';
  res = await viewer.post(`/api/channels/${creatorUser.username}/subscribe`);
  assert.equal(res.data.subscribed, true);

  const second = makeSampleVideo();
  res = await uploadVideo(creator, second, { title: 'Второй ролик' });
  const secondId = res.data.video.id;

  res = await viewer.get('/api/me/notifications');
  const newVideoNote = res.data.notifications.find((n) => n.type === 'new_video' && n.videoId === secondId);
  assert.ok(newVideoNote, 'subscribers were not notified about the new video');
  assert.equal(res.data.unread >= 1, true);

  step = 'commenting notifies the owner';
  res = await viewer.post(`/api/videos/${videoId}/comments`, { body: 'Отличный ролик!' });
  assert.equal(res.status, 201);
  res = await creator.get('/api/me/notifications');
  const commentNote = res.data.notifications.find((n) => n.type === 'comment');
  assert.ok(commentNote, 'the owner was not notified about the comment');
  assert.match(commentNote.body, /Отличный ролик/);

  step = 'authors are not notified about their own actions';
  await creator.post(`/api/videos/${videoId}/comments`, { body: 'Спасибо!' });
  res = await creator.get('/api/me/notifications');
  assert.equal(res.data.notifications.filter((n) => n.type === 'comment').length, 1);

  step = 'marking as read';
  res = await viewer.post('/api/me/notifications/read', {});
  assert.equal(res.data.unread, 0);

  /* ------------------------------------------------------ recommendations */

  step = 'recommendations react to history';
  await viewer.post(`/api/videos/${secondId}/heartbeat`, { seconds: 10, position: 5, duration: 60 });
  res = await viewer.get('/api/me/recommended');
  assert.equal(res.status, 200);
  assert.ok(!res.data.videos.some((v) => v.id === secondId), 'an already watched video must not be recommended');

  /* -------------------------------------------------------------- posts */

  step = 'community posts';
  res = await creator.post('/api/posts', { body: 'Всем привет! Скоро новое видео.' });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  const postId = res.data.post.id;

  res = await viewer.get(`/api/posts?channel=${creatorUser.username}`);
  assert.equal(res.data.posts.length, 1);
  assert.equal(res.data.posts[0].liked, false);

  res = await viewer.post(`/api/posts/${postId}/like`);
  assert.equal(res.data.liked, true);
  assert.equal(res.data.likes, 1);
  res = await viewer.post(`/api/posts/${postId}/like`);
  assert.equal(res.data.liked, false);

  step = 'strangers cannot delete a post';
  res = await viewer.del(`/api/posts/${postId}`);
  assert.equal(res.status, 403);
  res = await creator.del(`/api/posts/${postId}`);
  assert.equal(res.status, 200);

  /* ------------------------------------------------- scheduled publishing */

  step = 'a scheduled video stays hidden';
  const scheduled = makeSampleVideo();
  const publishAt = Date.now() + 3600000;
  res = await uploadVideo(creator, scheduled, { title: 'Премьера', publishAt });
  assert.equal(res.status, 201);
  const scheduledId = res.data.video.id;
  assert.equal(res.data.video.publishAt, publishAt);

  res = await viewer.get('/api/videos?limit=60');
  assert.ok(!res.data.videos.some((v) => v.id === scheduledId), 'a scheduled video must not be in the feed');

  res = await viewer.get(`/api/videos/${scheduledId}`);
  assert.equal(res.status, 403);
  assert.equal(res.data.publishAt, publishAt);

  res = await creator.get(`/api/videos/${scheduledId}`);
  assert.equal(res.status, 200, 'the owner can always open their own video');

  step = 'publishing early';
  res = await creator.patch(`/api/videos/${scheduledId}`, { publishAt: 0 });
  assert.equal(res.status, 200);
  res = await viewer.get(`/api/videos/${scheduledId}`);
  assert.equal(res.status, 200);

  step = 'cleanup';
  for (const id of [videoId, secondId, scheduledId]) await creator.del(`/api/videos/${id}`);
  for (const file of [clip, second, scheduled]) fs.rmSync(file, { force: true });

  console.log('✅ Аналитика и рост проверены');
})().catch((err) => {
  console.error(`❌ Growth test failed on "${step}":`, err.message);
  process.exit(1);
});
