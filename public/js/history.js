(async function main() {
  await bootstrap();

  if (!auth.user) return auth.requireLogin('/history');

  const grid = document.getElementById('grid');

  async function load() {
    const { history } = await api.get('/api/me/history');
    grid.innerHTML = history.length
      ? history.map((video) => `
        <div class="card" data-id="${video.id}">
          <a href="/watch/${video.id}">
            <div class="thumb">
              ${video.thumbUrl ? `<img src="${video.thumbUrl}" alt="" loading="lazy">` : `<div class="thumb-empty">${icon('play', '', 30)}</div>`}
              ${video.duration ? `<span class="duration">${fmt.duration(video.duration)}</span>` : ''}
              <span class="progress" style="position:absolute;left:0;right:0;bottom:0;height:4px;border-radius:0">
                <span class="progress-bar" style="width:${video.progress}%"></span>
              </span>
            </div>
            <div class="card-title">${escapeHtml(video.title)}</div>
          </a>
          <div class="card-meta">
            <a href="/@${escapeHtml(video.author.username)}">${escapeHtml(video.author.displayName)}</a>
          </div>
          <div class="row">
            <span class="card-meta">${fmt.ago(video.watchedAt)} · просмотрено ${video.progress}%</span>
            <span class="spacer"></span>
            <button class="btn btn-ghost btn-icon" data-remove="${video.id}" title="Убрать из истории">${icon('close', 'Убрать из истории')}</button>
          </div>
        </div>`).join('')
      : `<div class="empty" style="grid-column:1/-1"><div class="empty-icon">${icon('history', '', ICON_HERO)}</div>История пока пуста</div>`;
  }

  grid.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-remove]');
    if (!button) return;
    await api.del(`/api/me/history?videoId=${button.dataset.remove}`);
    load();
  });

  document.getElementById('clear-btn').addEventListener('click', async () => {
    if (!await confirmAction('Позиции воспроизведения тоже сотрутся — видео начнутся сначала.',
      { title: 'Очистить историю?', confirmLabel: 'Очистить', danger: true })) return;
    await api.del('/api/me/history');
    load();
  });

  load();
})();
