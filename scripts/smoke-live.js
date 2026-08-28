/**
 * Live streaming and captions: RTMP ingest, HLS output, live chat,
 * subtitle upload with SRT conversion, and the Shorts feed.
 */
'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn, execFileSync } = require('node:child_process');

const {
  BASE, createClient, createVerifiedUser, hasFfmpeg, makeSampleVideo, uploadVideo, waitForStatus,
} = require('./lib/client');

let step = 'start';

function publishRtmp(ingestUrl, streamKey, seconds) {
  return spawn('ffmpeg', [
    '-hide_banner', '-loglevel', 'error',
    '-re',
    '-f', 'lavfi', '-i', `testsrc=size=1280x720:rate=25:duration=${seconds}`,
    '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-g', '50',
    '-c:a', 'aac', '-shortest',
    '-f', 'flv', `${ingestUrl}/${streamKey}`,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
}

async function waitFor(check, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  throw new Error(`не дождались: ${label}`);
}

(async function run() {
  const client = createClient();
  await client.get('/api/health');
  const user = await createVerifiedUser(client, 'live');

  /* ---------------------------------------------------------- captions */

  step = 'upload a video for captions';
  const clip = makeSampleVideo({ real: true, duration: 4 });
  let res = await uploadVideo(client, clip, { title: 'Видео с субтитрами' });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  const videoId = res.data.video.id;

  step = 'upload SRT subtitles';
  const srt = [
    '1', '00:00:00,500 --> 00:00:02,000', 'Первая строка', '',
    '2', '00:00:02,100 --> 00:00:03,900', 'Вторая строка', '',
  ].join('\n');
  const srtPath = path.join(os.tmpdir(), `besy-sub-${Date.now()}.srt`);
  fs.writeFileSync(srtPath, srt);

  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(srtPath)], { type: 'text/plain' }), 'subs.srt');
  form.append('lang', 'ru');
  form.append('label', 'Русские');
  res = await client.call('POST', `/api/captions/${videoId}`, form, true);
  assert.equal(res.status, 201, JSON.stringify(res.data));
  const caption = res.data.caption;
  assert.equal(caption.lang, 'ru');
  assert.equal(caption.isDefault, true, 'the first track should be the default one');

  step = 'subtitles are served as WebVTT';
  let raw = await client.fetchRaw(caption.url);
  assert.equal(raw.status, 200);
  assert.match(raw.headers.get('content-type'), /text\/vtt/);
  const vtt = await raw.text();
  assert.match(vtt, /^WEBVTT/, 'SRT should have been converted');
  assert.match(vtt, /00:00:00\.500 --> 00:00:02\.000/, 'timings should use dots');
  assert.match(vtt, /Первая строка/);

  step = 'subtitles show up on the video';
  res = await client.get(`/api/videos/${videoId}`);
  assert.equal(res.data.video.captions.length, 1);
  assert.equal(res.data.video.captions[0].label, 'Русские');

  step = 'a label with markup survives the round trip verbatim';
  // The server stores labels as written; escaping is the renderer's job, and the
  // player must not paste this into innerHTML unescaped.
  const marked = new FormData();
  marked.append('file', new Blob([srt], { type: 'text/plain' }), 'subs.srt');
  marked.append('lang', 'en');
  marked.append('label', '<img src=x onerror=alert(1)>');
  res = await client.call('POST', `/api/captions/${videoId}`, marked, true);
  assert.equal(res.status, 201);
  assert.equal(res.data.caption.label, '<img src=x onerror=alert(1)>');
  await client.del(`/api/captions/${videoId}/${res.data.caption.id}`);

  step = 'garbage is refused';
  const junk = new FormData();
  junk.append('file', new Blob(['это не субтитры'], { type: 'text/plain' }), 'junk.srt');
  junk.append('lang', 'en');
  res = await client.call('POST', `/api/captions/${videoId}`, junk, true);
  assert.equal(res.status, 400);

  step = 'strangers cannot add subtitles';
  const stranger = createClient();
  await stranger.get('/api/health');
  await createVerifiedUser(stranger, 'nosub');
  const foreign = new FormData();
  foreign.append('file', new Blob([srt], { type: 'text/plain' }), 'subs.srt');
  foreign.append('lang', 'en');
  res = await stranger.call('POST', `/api/captions/${videoId}`, foreign, true);
  assert.equal(res.status, 403);

  step = 'delete subtitles';
  res = await client.del(`/api/captions/${videoId}/${caption.id}`);
  assert.equal(res.status, 200);
  raw = await client.fetchRaw(caption.url);
  assert.equal(raw.status, 404);

  fs.rmSync(srtPath, { force: true });

  /* ------------------------------------------------------------ shorts */

  // Shorts are flagged from the frame size ffprobe reports, so this section
  // needs a real clip. The caption checks above run on the stub file.
  let shortId = null;
  let shortClip = null;
  if (!hasFfmpeg()) {
    console.log('⚠ ffmpeg не найден — проверки Shorts пропущены');
  } else {
    step = 'a tall short clip is detected as a Short';
    shortClip = makeSampleVideo({ real: true, size: '360x640', duration: 4 });
    res = await uploadVideo(client, shortClip, { title: 'Вертикальный ролик' });
    assert.equal(res.status, 201);
    shortId = res.data.video.id;

    const readyShort = await waitForStatus(client, shortId, ['ready', 'failed']);
    assert.equal(readyShort.status, 'ready', readyShort.statusError || '');
    assert.equal(readyShort.isShort, true, 'a 360x640 clip must be flagged as a Short');

    step = 'the Shorts feed only carries Shorts';
    res = await client.get('/api/videos?kind=short&limit=50');
    assert.ok(res.data.videos.some((v) => v.id === shortId), 'the Short is missing from the feed');
    assert.ok(res.data.videos.every((v) => v.isShort), 'the feed must not contain regular videos');

    step = 'the regular feed excludes Shorts';
    res = await client.get('/api/videos?kind=video&limit=50');
    assert.ok(!res.data.videos.some((v) => v.id === shortId));

    /*
     * A Short lives on the Shorts screen and nowhere else. Every surface that
     * browses video has to keep them apart, because one grid can only have one
     * tile shape — and because what plays next after a landscape video should
     * not be a vertical one.
     */
    step = 'a Short is not offered next to a regular video';
    const anyVideo = (await client.get('/api/videos?kind=video&limit=1')).data.videos[0];
    res = await client.get(`/api/videos/${anyVideo.id}`);
    assert.ok(res.data.related.every((v) => !v.isShort), 'related must stay landscape');

    step = 'and a Short is offered only other Shorts';
    res = await client.get(`/api/videos/${shortId}`);
    assert.ok(res.data.related.every((v) => v.isShort), 'related to a Short must stay vertical');

    step = 'the subscriptions feed carries no Shorts';
    const follower = createClient();
    await follower.get('/api/health');
    await createVerifiedUser(follower, 'shortfan');
    await follower.post(`/api/channels/${user.username}/subscribe`);
    res = await follower.get('/api/channels/me/feed');
    assert.ok(!res.data.videos.some((v) => v.id === shortId), 'a Short reached the subscriptions feed');

    step = 'but search still finds one';
    res = await client.get('/api/videos?kind=short&limit=20&q=Вертикальный');
    assert.ok(res.data.videos.some((v) => v.id === shortId), 'search must reach Shorts');
  }

  /* -------------------------------------------------------------- live */

  let liveChecked = false;
  step = 'live config';
  res = await client.get('/api/live/config');
  if (!res.data.enabled) {
    console.log('⚠ эфиры выключены (BESY_LIVE != on) — часть проверок пропущена');
  } else if (!hasFfmpeg()) {
    console.log('⚠ ffmpeg не найден — проверки эфиров пропущены');
  } else {
    liveChecked = true;
    step = 'create a stream';
    res = await client.post('/api/live', { title: 'Тестовый эфир', visibility: 'public' });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    const stream = res.data.stream;
    assert.ok(stream.streamKey && stream.streamKey.length >= 16, 'stream key missing');
    assert.equal(stream.liveStatus, 'idle');

    step = 'the key is not exposed to viewers';
    res = await stranger.get(`/api/videos/${stream.id}`);
    assert.equal(res.status, 200);
    assert.equal(res.data.video.streamKey, undefined, 'the ingest key must never be published');

    step = 'publish over RTMP';
    const publisher = publishRtmp(res.data.video.hlsUrl ? stream.ingestUrl : stream.ingestUrl, stream.streamKey, 20);
    const stderr = [];
    publisher.stderr.on('data', (chunk) => stderr.push(String(chunk)));

    try {
      await waitFor(async () => {
        const check = await client.get(`/api/videos/${stream.id}`);
        return check.data.video?.liveStatus === 'live';
      }, 30000, 'эфир не перешёл в статус live');

      step = 'the live playlist appears';
      await waitFor(async () => {
        const playlist = await client.fetchRaw(`/media/live/${stream.id}/index.m3u8`);
        if (playlist.status !== 200) return false;
        const body = await playlist.text();
        return /#EXTINF/.test(body);
      }, 40000, 'HLS-плейлист эфира не появился');

      const playlistRes = await client.fetchRaw(`/media/live/${stream.id}/index.m3u8`);
      const body = await playlistRes.text();
      assert.equal(playlistRes.headers.get('cache-control'), 'no-store', 'a live playlist must not be cached');
      assert.match(body, /#EXT-X-MEDIA-SEQUENCE/);
      assert.ok(!/#EXT-X-ENDLIST/.test(body), 'a running stream must not be closed off');

      const segment = body.split('\n').find((line) => line.trim().endsWith('.ts'));
      const segRes = await client.fetchRaw(`/media/live/${stream.id}/${segment.trim()}`);
      assert.equal(segRes.status, 200);
      assert.ok(Number(segRes.headers.get('content-length')) > 1000, 'the segment is suspiciously small');

      step = 'the stream shows up in the live list';
      res = await stranger.get('/api/live');
      assert.ok(res.data.streams.some((s) => s.id === stream.id), 'missing from the live list');

      step = 'live chat';
      res = await stranger.post(`/api/live/${stream.id}/chat`, { body: 'Привет из чата' });
      assert.equal(res.status, 201, JSON.stringify(res.data));
      const messageId = res.data.message.id;

      res = await client.get(`/api/live/${stream.id}/chat`);
      assert.equal(res.data.messages.length, 1);
      assert.equal(res.data.messages[0].body, 'Привет из чата');

      res = await client.get(`/api/live/${stream.id}/chat?after=${messageId}`);
      assert.equal(res.data.messages.length, 0, 'the cursor should return only newer messages');

      step = 'the streamer can delete a viewer message';
      res = await client.del(`/api/live/${stream.id}/chat/${messageId}`);
      assert.equal(res.status, 200);

      step = 'rolling the key stops the stream';
      res = await client.post(`/api/live/${stream.id}/key`);
      assert.equal(res.status, 200);
      assert.notEqual(res.data.stream.streamKey, stream.streamKey);
    } finally {
      publisher.kill('SIGKILL');
      if (stderr.length) console.log('   ffmpeg (publisher):', stderr.join('').trim().split('\n').slice(-2).join(' '));
    }

    step = 'the stream ends';
    await waitFor(async () => {
      const check = await client.get(`/api/videos/${stream.id}`);
      return check.data.video?.liveStatus === 'ended';
    }, 30000, 'эфир не завершился');

    res = await stranger.get('/api/live');
    assert.ok(!res.data.streams.some((s) => s.id === stream.id), 'an ended stream must leave the list');

    step = 'an unknown key is refused';
    const rogue = publishRtmp(stream.ingestUrl, 'deadbeefdeadbeefdeadbeefdeadbeef', 5);
    await new Promise((resolve) => setTimeout(resolve, 2500));
    rogue.kill('SIGKILL');
    res = await client.get('/api/live');
    assert.ok(res.data.streams.length === 0 || !res.data.streams.some((s) => s.liveStatus === 'live' && s.id !== stream.id));

    // Regression: a live stream's file_key is '' (no uploaded file), and that
    // used to resolve straight to the storage root — deleting it threw EISDIR
    // instead of removing the video.
    step = 'deleting a live stream succeeds';
    res = await client.del(`/api/videos/${stream.id}`);
    assert.equal(res.status, 200, JSON.stringify(res.data));
    res = await client.get(`/api/videos/${stream.id}`);
    assert.equal(res.status, 404);
  }

  step = 'cleanup';
  await client.del(`/api/videos/${videoId}`);
  fs.rmSync(clip, { force: true });
  if (shortId) await client.del(`/api/videos/${shortId}`);
  if (shortClip) fs.rmSync(shortClip, { force: true });

  const covered = ['Субтитры'];
  if (shortId) covered.push('Shorts');
  if (liveChecked) covered.push('эфиры');
  console.log(`✅ Проверено: ${covered.join(', ')}`);
})().catch((err) => {
  console.error(`❌ Live test failed on "${step}":`, err.message);
  process.exit(1);
});
