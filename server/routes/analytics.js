'use strict';

const express = require('express');

const { db } = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();

const RETENTION_BUCKETS = 20; // one bucket per 5% of the video
const SOURCES = {
  direct: 'Прямые заходы',
  search: 'Поиск',
  related: 'Похожие видео',
  playlist: 'Плейлисты',
  channel: 'Страница канала',
  shorts: 'Лента Shorts',
  external: 'Внешние ссылки',
};

function dayKey(timestamp = Date.now()) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function ownedVideo(req, res) {
  const row = db.prepare('SELECT * FROM videos WHERE id = ?').get(req.params.id);
  if (!row) {
    res.status(404).json({ error: 'Видео не найдено' });
    return null;
  }
  if (row.user_id !== req.user.id && !req.user.isAdmin) {
    res.status(403).json({ error: 'Статистика доступна только владельцу' });
    return null;
  }
  return row;
}

/** Channel-level totals plus a per-day series for the whole channel. */
router.get('/channel', requireAuth, (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 28, 7), 365);
  const since = dayKey(Date.now() - days * 86400000);

  const totals = db.prepare(`
    SELECT COUNT(*) AS videos, COALESCE(SUM(views), 0) AS views
    FROM videos WHERE user_id = ?
  `).get(req.user.id);

  const series = db.prepare(`
    SELECT s.day, SUM(s.views) AS views, SUM(s.watch_seconds) AS watch
    FROM video_stats_daily s JOIN videos v ON v.id = s.video_id
    WHERE v.user_id = ? AND s.day >= ?
    GROUP BY s.day ORDER BY s.day
  `).all(req.user.id, since);

  const top = db.prepare(`
    SELECT v.id, v.title, v.views, v.thumb_key,
           COALESCE((SELECT SUM(watch_seconds) FROM video_stats_daily d WHERE d.video_id = v.id), 0) AS watch
    FROM videos v WHERE v.user_id = ?
    ORDER BY v.views DESC LIMIT 10
  `).all(req.user.id);

  const subscribers = db.prepare('SELECT COUNT(*) AS n FROM subscriptions WHERE channel_id = ?')
    .get(req.user.id).n;

  res.json({
    totals: {
      videos: totals.videos,
      views: totals.views,
      subscribers,
      watchSeconds: series.reduce((sum, row) => sum + row.watch, 0),
    },
    series: fillDays(series, days),
    top: top.map((row) => ({
      id: row.id,
      title: row.title,
      views: row.views,
      watchSeconds: row.watch,
      thumbUrl: row.thumb_key ? `/media/thumb/${row.id}` : null,
    })),
  });
});

/** Per-video detail: daily series, retention curve and traffic mix. */
router.get('/video/:id', requireAuth, (req, res) => {
  const video = ownedVideo(req, res);
  if (!video) return;

  const days = Math.min(Math.max(Number(req.query.days) || 28, 7), 365);
  const since = dayKey(Date.now() - days * 86400000);

  const series = db.prepare(`
    SELECT day, views, watch_seconds AS watch FROM video_stats_daily
    WHERE video_id = ? AND day >= ? ORDER BY day
  `).all(video.id, since);

  const buckets = db.prepare('SELECT bucket, hits FROM retention_buckets WHERE video_id = ? ORDER BY bucket')
    .all(video.id);
  // Everyone who watched at all passed bucket 0, so that is the 100% baseline.
  const peak = Math.max(buckets.find((row) => row.bucket === 0)?.hits || 0, 1);
  const retention = Array.from({ length: RETENTION_BUCKETS }, (_, index) => {
    const found = buckets.find((row) => row.bucket === index);
    return {
      percent: Math.round((index / RETENTION_BUCKETS) * 100),
      value: found ? Math.round((found.hits / peak) * 100) : 0,
    };
  });

  const sources = db.prepare('SELECT source, hits FROM traffic_sources WHERE video_id = ? ORDER BY hits DESC')
    .all(video.id);

  const watchTotal = db.prepare('SELECT COALESCE(SUM(watch_seconds), 0) AS n FROM video_stats_daily WHERE video_id = ?')
    .get(video.id).n;

  res.json({
    video: {
      id: video.id,
      title: video.title,
      views: video.views,
      duration: video.duration,
      createdAt: video.created_at,
      watchSeconds: watchTotal,
      averageViewSeconds: video.views ? Math.round(watchTotal / video.views) : 0,
      likes: db.prepare('SELECT COUNT(*) AS n FROM reactions WHERE video_id = ? AND value = 1').get(video.id).n,
      comments: db.prepare('SELECT COUNT(*) AS n FROM comments WHERE video_id = ?').get(video.id).n,
    },
    series: fillDays(series, days),
    retention,
    sources: sources.map((row) => ({
      id: row.source,
      label: SOURCES[row.source] || row.source,
      hits: row.hits,
    })),
  });
});

/** Pads the series so a chart always spans the whole requested window. */
function fillDays(rows, days) {
  const byDay = new Map(rows.map((row) => [row.day, row]));
  const out = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const day = dayKey(Date.now() - i * 86400000);
    const row = byDay.get(day);
    out.push({ day, views: row ? row.views : 0, watchSeconds: row ? row.watch : 0 });
  }
  return out;
}

module.exports = router;
module.exports.RETENTION_BUCKETS = RETENTION_BUCKETS;
module.exports.SOURCES = SOURCES;
module.exports.dayKey = dayKey;
