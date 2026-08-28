/**
 * Content matching: reference works, automatic detection of a re-uploaded
 * copy, per-work policy, disputes and moderator resolution.
 */
'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const {
  DATA_DIR, createClient, createVerifiedUser, hasFfmpeg, uploadVideo, waitForStatus,
} = require('./lib/client');

let step = 'start';

function promoteToAdmin(username) {
  execFileSync(process.execPath, [
    '--experimental-sqlite', path.join(__dirname, 'make-admin.js'), username,
  ], { stdio: 'ignore', env: { ...process.env, BESY_DATA_DIR: DATA_DIR } });
}

/** Renders a distinctive clip so unrelated fixtures never look alike. */
const TONE = "0.5*sin(2*PI*(300+700*sin(2*PI*t/3))*t)+0.3*sin(2*PI*(900+400*sin(2*PI*t/1.7))*t)";
const OTHER_TONE = "0.5*sin(2*PI*(1600+300*sin(2*PI*t/0.6))*t)+0.2*sin(2*PI*(2500+150*sin(2*PI*t/0.4))*t)";

function makeClip(name, { source, seconds = 10, size = '640x360', crf = 20, start = 0, tone = TONE } = {}) {
  const file = path.join(os.tmpdir(), `besy-match-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`);
  const args = ['-hide_banner', '-loglevel', 'error', '-y'];

  if (source) {
    if (start) args.push('-ss', String(start));
    args.push('-t', String(seconds), '-i', source, '-vf', `scale=${size.replace('x', ':')}`);
  } else {
    args.push(
      // mandelbrot and life are generators without a duration option; -t bounds them.
      '-t', String(seconds),
      '-f', 'lavfi', '-i', /^(mandelbrot|life)$/.test(name)
        ? `${name}=size=${size}:rate=25`
        : `${name}=size=${size}:rate=25:duration=${seconds}`,
      '-f', 'lavfi', '-i', `aevalsrc='${tone}':d=${seconds}`,
      '-shortest',
    );
  }

  args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-crf', String(crf), '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-movflags', '+faststart', file);

  execFileSync('ffmpeg', args, { stdio: 'ignore' });
  return file;
}

/**
 * Waits for a claim naming a specific work. The instance is shared with other
 * runs, so assertions target our own work rather than a total count.
 */
async function waitForClaim(client, videoId, workId, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  let claims = [];
  while (Date.now() < deadline) {
    const res = await client.get(`/api/matching/video/${videoId}`);
    claims = res.data.claims || [];
    const found = claims.find((claim) => claim.workId === workId);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`заявка по работе ${workId} не появилась (есть ${claims.length} других)`);
}

(async function run() {
  if (!hasFfmpeg()) {
    console.log('⚠ ffmpeg не найден — тест сопоставления пропущен');
    return;
  }

  const owner = createClient();
  await owner.get('/api/health');
  const ownerUser = await createVerifiedUser(owner, 'rights');

  const uploader = createClient();
  await uploader.get('/api/health');
  const uploaderUser = await createVerifiedUser(uploader, 'reup');

  step = 'matching is enabled';
  let res = await owner.get('/api/matching/policies');
  assert.equal(res.status, 200);
  if (!res.data.enabled) {
    console.log('⚠ сопоставление выключено (BESY_MATCHING=off) — тест пропущен');
    return;
  }
  assert.deepEqual(res.data.policies.map((p) => p.id).sort(), ['block', 'flag', 'track']);

  // mandelbrot keeps changing frame to frame, so both the video and the audio
  // fingerprint get exercised; a static test pattern would only prove the audio path.
  const originalFile = makeClip('mandelbrot', { seconds: 12 });
  const files = [originalFile];

  step = 'upload the original';
  res = await uploadVideo(owner, originalFile, { title: 'Оригинальный ролик' });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  const originalId = res.data.video.id;
  await waitForStatus(owner, originalId, ['ready', 'failed']);

  step = 'register it as a reference work';
  res = await owner.post('/api/matching/works', {
    videoId: originalId, title: 'Мой ролик', policy: 'flag',
  });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  const workId = res.data.work.id;
  assert.equal(res.data.work.policy, 'flag');

  step = 'a work cannot be registered twice';
  res = await owner.post('/api/matching/works', { videoId: originalId, title: 'Дубль' });
  assert.equal(res.status, 409);

  step = 'only your own video can be a reference';
  res = await uploader.post('/api/matching/works', { videoId: originalId, title: 'Чужое' });
  assert.equal(res.status, 403);

  step = 'a re-encoded, rescaled copy is detected';
  const copyFile = makeClip('copy', { source: originalFile, seconds: 12, size: '426x240', crf: 34 });
  files.push(copyFile);
  res = await uploadVideo(uploader, copyFile, { title: 'Перезалив' });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  const copyId = res.data.video.id;
  await waitForStatus(uploader, copyId, ['ready', 'failed']);

  const claim = await waitForClaim(uploader, copyId, workId);
  assert.ok(claim.secondsMatched >= 5, `слишком короткое совпадение: ${claim.secondsMatched}`);
  assert.equal(claim.status, 'active');
  assert.equal(claim.policy, 'flag');

  step = 'a flag policy leaves the video watchable';
  res = await uploader.get(`/api/videos/${copyId}`);
  assert.equal(res.status, 200);
  assert.equal(res.data.video.blocked, false);

  step = 'the rights holder sees the detection';
  res = await owner.get('/api/matching/detections');
  assert.ok(res.data.detections.some((d) => d.videoId === copyId), 'детект не показан правообладателю');

  step = 'the uploader sees the claim against them';
  res = await uploader.get('/api/matching/claims');
  const mine = res.data.claims.find((c) => c.id === claim.id);
  assert.ok(mine, 'заявка не видна загрузившему');
  assert.equal(mine.uploader, uploaderUser.username);

  step = 'unrelated footage is not claimed';
  const unrelatedFile = makeClip('life', { seconds: 12, tone: OTHER_TONE });
  files.push(unrelatedFile);
  res = await uploadVideo(uploader, unrelatedFile, { title: 'Своё видео' });
  const unrelatedId = res.data.video.id;
  await waitForStatus(uploader, unrelatedId, ['ready', 'failed']);
  await new Promise((resolve) => setTimeout(resolve, 3000));
  res = await uploader.get(`/api/matching/video/${unrelatedId}`);
  assert.ok(
    !res.data.claims.some((c) => c.workId === workId),
    'ложное срабатывание на чужом материале'
  );

  step = 'the owner never gets claimed against their own work';
  res = await owner.get(`/api/matching/video/${originalId}`);
  assert.ok(!res.data.claims.some((c) => c.workId === workId));

  step = 'strangers see only that a claim exists';
  const bystander = createClient();
  await bystander.get('/api/health');
  res = await bystander.get(`/api/matching/video/${copyId}`);
  const publicClaim = res.data.claims.find((c) => c.workTitle === 'Мой ролик');
  assert.ok(publicClaim, 'посторонний не видит факт заявки');
  assert.equal(publicClaim.secondsMatched, undefined, 'посторонним не показываем детали');
  assert.equal(publicClaim.workId, undefined, 'посторонним не показываем идентификатор работы');

  step = 'disputing a claim';
  res = await uploader.post(`/api/matching/claims/${claim.id}/dispute`, {});
  assert.equal(res.status, 400, 'нужна причина спора');
  res = await uploader.post(`/api/matching/claims/${claim.id}/dispute`, { note: 'Это моя съёмка' });
  assert.equal(res.status, 200);
  res = await uploader.post(`/api/matching/claims/${claim.id}/dispute`, { note: 'Ещё раз' });
  assert.equal(res.status, 409, 'повторный спор недопустим');

  step = 'strangers cannot dispute';
  res = await bystander.post(`/api/matching/claims/${claim.id}/dispute`, { note: 'хочу' });
  assert.ok([401, 403].includes(res.status));

  step = 'the dispute reaches moderation';
  const admin = createClient();
  await admin.get('/api/health');
  const adminUser = await createVerifiedUser(admin, 'mmod');
  promoteToAdmin(adminUser.username);
  await admin.post('/api/auth/login', { login: adminUser.username, password: adminUser.password });

  res = await admin.get('/api/matching/disputes');
  assert.ok(res.data.disputes.some((d) => d.id === claim.id), 'спор не попал в очередь');
  assert.equal(res.data.disputes.find((d) => d.id === claim.id).disputeNote, 'Это моя съёмка');

  step = 'a moderator upholds the claim';
  res = await admin.post(`/api/matching/disputes/${claim.id}/resolve`, {
    decision: 'uphold', resolution: 'Совпадение подтверждено',
  });
  assert.equal(res.status, 200);
  res = await uploader.get('/api/matching/claims');
  assert.equal(res.data.claims.find((c) => c.id === claim.id).status, 'upheld');

  step = 'the rights holder can withdraw the claim';
  res = await owner.post(`/api/matching/claims/${claim.id}/release`, { resolution: 'Разрешаю' });
  assert.equal(res.status, 200);
  res = await uploader.get('/api/matching/claims');
  assert.equal(res.data.claims.find((c) => c.id === claim.id).status, 'released');

  /* ------------------------------------------------------ block policy */

  step = 'a block policy takes the copy down';
  res = await owner.patch(`/api/matching/works/${workId}`, { policy: 'block' });
  assert.equal(res.data.work.policy, 'block');

  const secondCopy = makeClip('copy2', { source: originalFile, seconds: 10, size: '512x288', crf: 30 });
  files.push(secondCopy);
  res = await uploadVideo(uploader, secondCopy, { title: 'Второй перезалив' });
  const secondId = res.data.video.id;
  await waitForStatus(uploader, secondId, ['ready', 'failed']);

  const blockedClaim = await waitForClaim(uploader, secondId, workId);
  assert.equal(blockedClaim.policy, 'block');

  res = await bystander.get(`/api/videos/${secondId}`);
  assert.equal(res.status, 451, 'видео по политике block должно быть заблокировано');

  step = 'releasing the claim brings the video back';
  res = await owner.post(`/api/matching/claims/${blockedClaim.id}/release`, { resolution: 'Ошибка' });
  assert.equal(res.status, 200);
  res = await bystander.get(`/api/videos/${secondId}`);
  assert.equal(res.status, 200, 'после снятия заявки видео должно открываться');

  step = 'deactivating a work stops new claims';
  res = await owner.patch(`/api/matching/works/${workId}`, { active: false });
  assert.equal(res.data.work.active, false);

  const thirdCopy = makeClip('copy3', { source: originalFile, seconds: 10, size: '640x360', crf: 28 });
  files.push(thirdCopy);
  res = await uploadVideo(uploader, thirdCopy, { title: 'Третий перезалив' });
  const thirdId = res.data.video.id;
  await waitForStatus(uploader, thirdId, ['ready', 'failed']);
  await new Promise((resolve) => setTimeout(resolve, 3000));
  res = await uploader.get(`/api/matching/video/${thirdId}`);
  assert.ok(
    !res.data.claims.some((c) => c.workId === workId),
    'отключённая работа не должна ловить'
  );

  step = 'cleanup';
  await owner.del(`/api/matching/works/${workId}`);
  await owner.del(`/api/videos/${originalId}`);
  for (const id of [copyId, unrelatedId, secondId, thirdId]) await uploader.del(`/api/videos/${id}`);
  for (const file of files) fs.rmSync(file, { force: true });

  console.log(`✅ Сопоставление контента проверено (совпадение ${claim.secondsMatched} с, точность ${claim.score})`);
})().catch((err) => {
  console.error(`❌ Matching test failed on "${step}":`, err.message);
  process.exit(1);
});
