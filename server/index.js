'use strict';

const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('node:path');
const multer = require('multer');

const { attachUser } = require('./auth');
const security = require('./security');
require('./db'); // ensures data dirs + schema exist before routes load
const transcode = require('./transcode');
const live = require('./live');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

app.disable('x-powered-by');

/*
 * Whose X-Forwarded-For to believe.
 *
 * This used to be `true`, meaning anyone's: the address every rate limit, the
 * brute-force lockout and the view counter key off is taken from a header the
 * client writes, so a single machine could spend everyone's budget or none of
 * its own. That is only safe when something in front is guaranteed to overwrite
 * the header, which is a property of the deployment rather than of the code.
 *
 * So it is a setting, and it is off unless you say otherwise:
 *   unset / off   — trust nobody; req.ip is the socket address
 *   1, 2, …       — trust that many hops (1 behind a single reverse proxy)
 *   a, b, c       — trust these addresses or CIDR ranges
 */
function trustProxySetting(raw) {
  const value = String(raw ?? '').trim();
  if (!value || value === 'false' || value === 'off' || value === '0') return false;
  if (/^\d+$/.test(value)) return Number(value);
  if (value === 'true' || value === 'on') return true;
  return value.split(',').map((entry) => entry.trim()).filter(Boolean);
}

app.set('trust proxy', trustProxySetting(process.env.BESY_TRUST_PROXY));

app.use(security.securityHeaders);
app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: false, limit: '256kb' }));
app.use(cookieParser());
app.use(security.csrfToken);
app.use(attachUser);

// Broad safety net; individual routes add tighter budgets of their own.
app.use('/api', security.rateLimit({
  name: 'api',
  limit: Number(process.env.BESY_API_RATE_LIMIT) || 600,
  windowMs: 60 * 1000,
}));
app.use('/api', security.csrfProtection);

app.use('/api/auth', require('./routes/auth'));
app.use('/api/videos', require('./routes/videos'));
app.use('/api/channels', require('./routes/channels'));
app.use('/api/playlists', require('./routes/playlists'));
app.use('/api/moderation', require('./routes/moderation'));
app.use('/api/captions', require('./routes/captions'));
app.use('/api/live', require('./routes/live'));
app.use('/api/analytics', require('./routes/analytics'));
app.use('/api/me', require('./routes/me'));
app.use('/api/branding', require('./routes/branding'));
app.use('/api/posts', require('./routes/posts'));
app.use('/api/matching', require('./routes/matching'));
app.use('/media', require('./routes/media'));

app.get('/api/health', (req, res) => res.json({ ok: true, uptime: process.uptime() }));

app.get('/api/config', (req, res) => {
  res.json({
    signedMedia: security.SIGNED_MEDIA,
    maxUploadMb: Number(process.env.BESY_MAX_UPLOAD_MB || 2048),
    emailVerificationRequired: process.env.BESY_REQUIRE_EMAIL_VERIFICATION !== 'off',
  });
});

// hls.js ships as a dependency so the player works without a CDN.
const HLS_JS_PATH = path.join(__dirname, '..', 'node_modules', 'hls.js', 'dist', 'hls.min.js');
app.get('/vendor/hls.js', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=604800');
  res.sendFile(HLS_JS_PATH);
});

app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

// Pretty URLs: /watch/<id>, /@<username>
app.get('/watch/:id', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'watch.html')));
app.get('/@:username', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'channel.html')));
app.get('/playlist/:id', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'playlist.html')));

app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Не найдено' });
  res.status(404).sendFile(path.join(PUBLIC_DIR, '404.html'));
});

// eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity.
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE'
      ? `Файл больше допустимого лимита (${process.env.BESY_MAX_UPLOAD_MB || 2048} МБ)`
      : `Ошибка загрузки: ${err.message}`;
    return res.status(413).json({ error: message });
  }
  if (err && err.message && res.statusCode < 400) {
    console.error(err);
    return res.status(400).json({ error: err.message });
  }
  console.error(err);
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

app.listen(PORT, async () => {
  console.log(`Besy запущен: http://localhost:${PORT}`);
  const ffmpegReady = await transcode.checkTools();
  console.log(ffmpegReady
    ? '[transcode] ffmpeg найден — включено адаптивное качество (HLS)'
    : '[transcode] ffmpeg не найден — видео отдаются как есть, без HLS');
  transcode.resumePending();
  live.resetStaleStreams();
  live.start();
});
