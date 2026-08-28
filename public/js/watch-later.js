(async function main() {
  await bootstrap();

  if (!auth.user) return auth.requireLogin('/watch-later');

  const grid = document.getElementById('grid');

  async function load() {
    const { videos } = await api.get('/api/me/watch-later');
    grid.innerHTML = videos.length
      ? videos.map((video) => `
        <div class="card" data-id="${video.id}">
          <a href="/watch/${video.id}">
            <div class="thumb">
              ${video.thumbUrl ? `<img src="${video.thumbUrl}" alt="" loading="lazy">` : `<div class="thumb-empty">${icon('play', '', 30)}</div>`}
              ${video.duration ? `<span class="duration">${fmt.duration(video.duration)}</span>` : ''}
            </div>
            <div class="card-title">${escapeHtml(video.title)}</div>
          </a>
          <div class="card-meta">
            <a href="/@${escapeHtml(video.author.username)}">${escapeHtml(video.author.displayName)}</a>
          </div>
          <div class="row">
            <span class="card-meta">${fmt.views(video.views)}</span>
            <span class="spacer"></span>
            <button class="btn btn-ghost btn-icon" data-remove="${video.id}" title="Убрать">${icon('close', 'Убрать')}</button>
          </div>
        </div>`).join('')
      : `<div class="empty" style="grid-column:1/-1"><div class="empty-icon">${icon('later', '', ICON_HERO)}</div>Список пуст</div>`;
  }

  grid.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-remove]');
    if (!button) return;
    await api.post('/api/me/watch-later', { videoId: button.dataset.remove });
    load();
  });

  load();
})();
