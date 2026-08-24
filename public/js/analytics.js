(async function main() {
  await bootstrap();

  if (!auth.user) return auth.requireLogin('/analytics');

  const content = document.getElementById('content');
  const rangeSelect = document.getElementById('range');
  const videoId = new URLSearchParams(location.search).get('video');

  function formatWatch(seconds) {
    const hours = seconds / 3600;
    if (hours >= 1) return `${hours.toFixed(hours < 10 ? 1 : 0)} ч`;
    return `${Math.round(seconds / 60)} мин`;
  }

  function shortDay(day) {
    const [, month, date] = day.split('-');
    return `${Number(date)}.${month}`;
  }

  function tiles(items) {
    return `<div class="stat-row">${items.map((item) => `
      <div class="stat-tile">
        <div class="stat-value">${item.value}</div>
        <div class="stat-label">${escapeHtml(item.label)}</div>
      </div>`).join('')}</div>`;
  }

  async function renderChannel(days) {
    const data = await api.get(`/api/analytics/channel?days=${days}`);

    content.innerHTML = `
      ${tiles([
        { value: fmt.count(data.totals.views), label: 'Просмотров всего' },
        { value: formatWatch(data.totals.watchSeconds), label: `Время просмотра за ${days} дн.` },
        { value: fmt.count(data.totals.subscribers), label: 'Подписчиков' },
        { value: fmt.count(data.totals.videos), label: 'Видео' },
      ])}
      <div id="views-chart"></div>
      <div id="watch-chart"></div>
      <h2 class="mt-24">Самые популярные видео</h2>
      <div id="top"></div>`;

    // Two measures of different scale get two charts, never a second y-axis.
    lineChart(document.getElementById('views-chart'), {
      title: `Просмотры за ${days} дней`,
      points: data.series.map((row) => ({ label: shortDay(row.day), value: row.views })),
      formatValue: (value) => fmt.count(value),
    });

    lineChart(document.getElementById('watch-chart'), {
      title: `Время просмотра за ${days} дней`,
      points: data.series.map((row) => ({ label: shortDay(row.day), value: Math.round(row.watchSeconds / 60) })),
      formatValue: (value) => `${value} мин`,
      color: '#3d7fd6',
    });

    document.getElementById('top').innerHTML = data.top.length
      ? `<div class="panel">${data.top.map((video) => `
          <div class="row" style="gap:12px;padding:8px 0;border-bottom:1px solid var(--border)">
            <a href="/watch/${video.id}" style="width:96px;flex-shrink:0">
              <div class="thumb" style="margin:0">
                ${video.thumbUrl ? `<img src="${video.thumbUrl}" alt="">` : `<div class="thumb-empty">${icon('play', '', 30)}</div>`}
              </div>
            </a>
            <div style="flex:1;min-width:0">
              <div class="card-title" style="margin:0">${escapeHtml(video.title)}</div>
              <div class="card-meta">${fmt.views(video.views)} · ${formatWatch(video.watchSeconds)}</div>
            </div>
            <a class="btn" href="/analytics?video=${video.id}">Подробнее</a>
          </div>`).join('')}</div>`
      : '<div class="hint">Пока нет данных</div>';
  }

  async function renderVideo(days) {
    const data = await api.get(`/api/analytics/video/${videoId}?days=${days}`);
    document.getElementById('page-title').textContent = data.video.title;

    content.innerHTML = `
      ${tiles([
        { value: fmt.count(data.video.views), label: 'Просмотров' },
        { value: formatWatch(data.video.watchSeconds), label: 'Время просмотра' },
        { value: fmt.duration(data.video.averageViewSeconds), label: 'Средний просмотр' },
        { value: fmt.count(data.video.likes), label: 'Лайков' },
        { value: fmt.count(data.video.comments), label: 'Комментариев' },
      ])}
      <div id="views-chart"></div>
      <div id="retention-chart"></div>
      <div id="sources-chart"></div>
      <div class="hint">Удержание показывает, какая доля зрителей остаётся к каждой точке ролика.</div>`;

    lineChart(document.getElementById('views-chart'), {
      title: `Просмотры за ${days} дней`,
      points: data.series.map((row) => ({ label: shortDay(row.day), value: row.views })),
      formatValue: (value) => fmt.count(value),
    });

    retentionChart(document.getElementById('retention-chart'), {
      title: 'Удержание аудитории',
      points: data.retention,
    });

    if (data.sources.length) {
      barChart(document.getElementById('sources-chart'), {
        title: 'Откуда приходят зрители',
        items: data.sources.map((source) => ({ label: source.label, value: source.hits })),
        formatValue: (value) => fmt.count(value),
      });
    } else {
      document.getElementById('sources-chart').innerHTML =
        '<div class="chart"><div class="chart-title">Откуда приходят зрители</div><div class="hint">Пока нет данных</div></div>';
    }
  }

  async function render() {
    content.innerHTML = '<div class="hint">Загрузка…</div>';
    const days = Number(rangeSelect.value);
    try {
      await (videoId ? renderVideo(days) : renderChannel(days));
    } catch (err) {
      content.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
    }
  }

  rangeSelect.addEventListener('change', render);
  render();
})();
