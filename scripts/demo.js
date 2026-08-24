/**
 * Starts Besy with a small library already in it, so the first thing you see
 * is a working service rather than an empty catalogue.
 *
 *   npm run demo
 *
 * Writes to its own data directory (data-demo by default), so it never touches
 * a real instance. Delete that folder to start over. The server keeps running
 * in the foreground; Ctrl+C stops it.
 */
'use strict';

// Fails with an explanation before anything reaches node:sqlite.
require('./check-node');

const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.BESY_DATA_DIR || path.join(ROOT, 'data-demo');
const BASE = `http://127.0.0.1:${PORT}`;

const ACCOUNTS = {
  // The first account registered on an instance becomes its moderator, so the
  // studio owner is created first and gets the moderation panel too.
  owner:  { username: 'demo', email: 'demo@besy.local', password: 'probe-2026-video', displayName: 'Аппаратная' },
  viewer: { username: 'viewer', email: 'viewer@besy.local', password: 'probe-2026-video', displayName: 'Пётр Ковалёв' },
};

const VIDEOS = [
  {
    title: 'Собираем домашний видеохостинг на одном процессе',
    description: 'Почему self-hosted, что нужно из железа и во что упирается на практике.\n\n'
      + '0:00 Вступление\n1:24 Транскодирование\n5:40 Хранилище\n9:12 Что дальше',
    tags: 'инфраструктура,хостинг,видео',
  },
  {
    title: 'Лестница HLS: зачем четыре качества вместо одного',
    description: 'Разбираем 360p, 480p, 720p и 1080p — какой битрейт выбрать и почему '
      + 'кодировщик не строит ступени выше исходной высоты.',
    tags: 'hls,кодирование',
  },
  {
    title: 'RTMP-эфир без облака: приём, перегон, чат',
    description: 'Полная цепочка от OBS до зрителя на своём сервере: приём RTMP, '
      + 'скользящее окно HLS, задержка и чат.',
    tags: 'эфиры,rtmp',
  },
  {
    title: 'Отпечатки контента: как ловить перезаливы',
    description: 'Считаем отпечатки аудиодорожки и видеоряда, сверяем каждую загрузку '
      + 'и заводим заявку правообладателю.',
    tags: 'защита,отпечатки',
  },
  {
    title: 'Range-запросы и перемотка: что ломается чаще всего',
    description: 'Суффиксные диапазоны, ответ 416 и почему плеер отказывается мотать.',
    tags: 'http,плеер',
  },
  {
    title: 'Subtitle-инъекция: разбор реального бага',
    description: 'Метка субтитров попадала в меню плеера без экранирования. '
      + 'CSP исполнение блокировала, но инъекция была настоящей.',
    tags: 'безопасность,xss',
  },
];

const COMMENTS = [
  ['viewer', 0, 'Наконец-то кто-то объяснил лестницу качеств человеческим языком.'],
  ['viewer', 0, 'А что с задержкой на эфирах? Сколько секунд до зрителя?'],
  ['owner', 0, 'Около шести — окно HLS в три сегмента по две секунды.'],
  ['viewer', 3, 'Отпечатки считаются по всему файлу или по ключевым кадрам?'],
];

function log(message) {
  process.stdout.write(`[demo] ${message}\n`);
}

/** Waits for the server to answer its health check. */
async function waitForHealth(timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return;
    } catch { /* not listening yet */ }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`сервер не ответил на ${BASE}/api/health за ${timeoutMs / 1000} с`);
}

async function register(client, account) {
  const res = await client.post('/api/auth/register', {
    username: account.username,
    email: account.email,
    password: account.password,
    displayName: account.displayName,
  });
  if (res.status !== 201) throw new Error(`регистрация ${account.username}: ${JSON.stringify(res.data)}`);
  return res.data.user;
}

async function seed(lib) {
  const { createClient, makeSampleVideo, uploadVideo, hasFfmpeg } = lib;

  const owner = createClient(BASE);
  await owner.get('/api/health');
  await register(owner, ACCOUNTS.owner);
  await owner.patch('/api/auth/me', {
    displayName: ACCOUNTS.owner.displayName,
    about: 'Разбираем видеоинфраструктуру: транскодирование, доставка, эфиры, защита контента.',
  });

  const viewer = createClient(BASE);
  await viewer.get('/api/health');
  await register(viewer, ACCOUNTS.viewer);

  const clients = { owner, viewer };
  const withFfmpeg = hasFfmpeg();
  log(withFfmpeg
    ? 'ffmpeg найден — видео будут с обложками и лестницей качеств'
    : 'ffmpeg не найден — видео загрузятся, но без обложек, качеств и Shorts');

  const ids = [];
  for (const [index, video] of VIDEOS.entries()) {
    // A tall clip lands in the Shorts feed, but only ffmpeg can make one.
    const short = withFfmpeg && index === VIDEOS.length - 1;
    const file = makeSampleVideo({
      real: true,
      duration: 4,
      size: short ? '360x640' : '640x360',
    });
    const res = await uploadVideo(owner, file, {
      title: video.title,
      description: video.description,
      tags: video.tags,
    });
    fs.rmSync(file, { force: true });
    if (res.status !== 201) throw new Error(`загрузка «${video.title}»: ${JSON.stringify(res.data)}`);
    ids.push(res.data.video.id);
    log(`загружено ${index + 1}/${VIDEOS.length}: ${video.title}`);
  }

  // One view each: the counter deduplicates by viewer key with a cooldown, so
  // asking for more would not raise the number, only the noise.
  for (const [index, id] of ids.entries()) {
    await viewer.post(`/api/videos/${id}/view`, {});
    if (index % 2 === 0) await viewer.post(`/api/videos/${id}/reaction`, { value: 1 });
  }

  for (const [who, videoIndex, body] of COMMENTS) {
    await clients[who].post(`/api/videos/${ids[videoIndex]}/comments`, { body });
  }

  await viewer.post(`/api/channels/${ACCOUNTS.owner.username}/subscribe`, {});

  const playlist = await owner.post('/api/playlists', {
    title: 'Основы доставки видео',
    visibility: 'public',
  });
  if (playlist.status === 201) {
    for (const id of ids.slice(0, 4)) {
      await owner.post(`/api/playlists/${playlist.data.playlist.id}/items`, { videoId: id });
    }
  }

  await owner.post('/api/posts', {
    body: 'На выходных выложу разбор того, как считаются отпечатки. Пишите, что непонятно.',
  });

  for (const id of ids.slice(0, 3)) await viewer.post('/api/me/watch-later', { videoId: id });

  // One open report, so the moderation queue is not empty on first look.
  await viewer.post('/api/moderation/reports', {
    targetType: 'video',
    videoId: ids[ids.length - 1],
    reason: 'spam',
    details: 'Похоже на перезалив чужого материала.',
  });

  return { ids, playlist: playlist.data?.playlist?.id };
}

/** True when this data directory already holds a seeded demo. */
async function alreadySeeded(createClient) {
  const probe = createClient(BASE);
  await probe.get('/api/health');
  const res = await probe.post('/api/auth/login', {
    login: ACCOUNTS.owner.username,
    password: ACCOUNTS.owner.password,
  });
  return res.status === 200;
}

function banner(seeded) {
  const line = '─'.repeat(58);
  const rows = [
    '',
    line,
    `  Besy готов:  ${BASE}`,
    '',
    `  Автор и модератор   ${ACCOUNTS.owner.username} / ${ACCOUNTS.owner.password}`,
    `  Зритель             ${ACCOUNTS.viewer.username} / ${ACCOUNTS.viewer.password}`,
    '',
    seeded ? '  Библиотека наполнена.' : '  Данные уже были — оставил как есть.',
    `  Данные: ${path.relative(ROOT, DATA_DIR) || DATA_DIR}  (удалите папку, чтобы начать заново)`,
    '',
    '  Что посмотреть:',
    '    /            лента и лестница качеств на карточках',
    '    /studio      защита контента, статусы обработки, эфиры',
    '    /settings    блокировки, выгрузка данных, удаление аккаунта',
    '    /moderation  очередь жалоб и аудит-лог',
    '',
    '  Ctrl+C — остановить.',
    line,
    '',
  ];
  process.stdout.write(`${rows.join('\n')}\n`);
}

(async function main() {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const server = spawn(process.execPath, ['--experimental-sqlite', path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    stdio: ['ignore', 'inherit', 'inherit'],
    env: {
      ...process.env,
      PORT: String(PORT),
      BESY_DATA_DIR: DATA_DIR,
      // A demo has no mail server, and making people dig a link out of
      // data-demo/outbox before they can click anything is a poor first minute.
      BESY_REQUIRE_EMAIL_VERIFICATION: 'off',
      // Seeding registers and uploads in a burst that the normal budgets would
      // refuse. The limiters themselves stay on for anything you do by hand.
      BESY_AUTH_RATE_LIMIT: process.env.BESY_AUTH_RATE_LIMIT || '200',
    },
  });

  const stop = (signal) => {
    server.kill(signal);
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));
  server.on('exit', (code) => process.exit(code ?? 0));

  try {
    await waitForHealth();
    // Required lazily: the module reads BESY_URL at load time.
    process.env.BESY_URL = BASE;
    process.env.BESY_DATA_DIR = DATA_DIR;
    const lib = require('./lib/client');

    if (await alreadySeeded(lib.createClient)) {
      banner(false);
    } else {
      log('наполняю библиотеку…');
      await seed(lib);
      banner(true);
    }
  } catch (err) {
    process.stderr.write(`[demo] не удалось наполнить: ${err.message}\n`);
    process.stderr.write('[demo] сервер продолжает работать — можно зарегистрироваться вручную\n');
  }
})();
