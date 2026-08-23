'use strict';

const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('node:path');
const multer = require('multer');

const { attachUser } = require('./auth');
require('./db'); // ensures data dirs + schema exist before routes load

const app = express();
const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

app.disable('x-powered-by');
app.set('trust proxy', true);

app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: false, limit: '256kb' }));
app.use(cookieParser());
app.use(attachUser);

app.use('/api/auth', require('./routes/auth'));
app.use('/api/videos', require('./routes/videos'));
app.use('/api/channels', require('./routes/channels'));
app.use('/media', require('./routes/media'));

app.get('/api/health', (req, res) => res.json({ ok: true, uptime: process.uptime() }));

app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

// Pretty URLs: /watch/<id>, /@<username>
app.get('/watch/:id', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'watch.html')));
app.get('/@:username', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'channel.html')));

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

app.listen(PORT, () => {
  console.log(`Besy запущен: http://localhost:${PORT}`);
});
