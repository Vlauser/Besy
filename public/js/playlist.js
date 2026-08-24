(async function main() {
  await bootstrap();

  const playlistId = location.pathname.split('/').filter(Boolean)[1];
  const headEl = document.getElementById('head');
  const itemsEl = document.getElementById('items');

  let data;
  try {
    data = await api.get(`/api/playlists/${playlistId}`);
  } catch (err) {
    headEl.innerHTML = `<div class="empty"><div class="empty-icon">${icon('ban', '', ICON_HERO)}</div>${escapeHtml(err.message)}</div>`;
    return;
  }

  const { playlist, videos, isOwner } = data;
  document.title = `${playlist.title} — Besy`;

  const VISIBILITY = { public: 'Публичный', unlisted: 'По ссылке', private: 'Приватный' };
  const total = videos.reduce((sum, video) => sum + (video.duration || 0), 0);

  headEl.innerHTML = `
    <div class="channel-head">
      <div class="thumb" style="width:260px;margin:0">
        ${playlist.cover ? `<img src="${playlist.cover}" alt="">` : `<div class="thumb-empty">${icon('save', '', 30)}</div>`}
      </div>
      <div style="flex:1;min-width:220px">
        <h1 style="margin-bottom:6px">${escapeHtml(playlist.title)}</h1>
        <div class="channel-stats">
          <a href="/@${escapeHtml(playlist.author.username)}">${escapeHtml(playlist.author.displayName)}</a> ·
          ${videos.length} ${fmt.plural(videos.length, 'видео', 'видео', 'видео')} ·
          ${fmt.duration(total)} · ${VISIBILITY[playlist.visibility]}
        </div>
        ${playlist.description ? `<div class="hint mt-16" style="white-space:pre-wrap">${escapeHtml(playlist.description)}</div>` : ''}
        <div class="row mt-16">
          ${videos.length ? `<a class="btn btn-primary" href="/watch/${videos[0].id}?list=${playlist.id}">${icon('play')}Смотреть подряд</a>` : ''}
          ${isOwner ? `<button class="btn" id="edit-btn">${icon('edit')}Изменить</button>` : ''}
          ${isOwner ? `<button class="btn btn-danger" id="delete-btn">${icon('trash')}Удалить плейлист</button>` : ''}
        </div>
      </div>
    </div>`;

  function renderItems() {
    itemsEl.innerHTML = videos.length
      ? `<div class="related">${videos.map((video, index) => `
        <div class="related-item" data-id="${video.id}">
          <a href="/watch/${video.id}?list=${playlist.id}">
            <div class="thumb">
              ${video.thumbUrl ? `<img src="${video.thumbUrl}" alt="" loading="lazy">` : `<div class="thumb-empty">${icon('play', '', 30)}</div>`}
              ${video.duration ? `<span class="duration">${fmt.duration(video.duration)}</span>` : ''}
            </div>
          </a>
          <div>
            <div class="card-title"><span class="hint">${index + 1}.</span> ${escapeHtml(video.title)}</div>
            <div class="card-meta">${escapeHtml(video.author.displayName)}</div>
            <div class="card-meta">${fmt.views(video.views)} · ${fmt.ago(video.createdAt)}</div>
            ${isOwner ? `
              <div class="row mt-16">
                <button class="btn btn-icon" data-action="up" title="Выше" ${index === 0 ? 'disabled' : ''}>${icon('up', 'Выше')}</button>
                <button class="btn btn-icon" data-action="down" title="Ниже" ${index === videos.length - 1 ? 'disabled' : ''}>${icon('down', 'Ниже')}</button>
                <button class="btn btn-danger" data-action="remove">Убрать</button>
              </div>` : ''}
          </div>
        </div>`).join('')}</div>`
      : `<div class="empty"><div class="empty-icon">${icon('save', '', ICON_HERO)}</div>В плейлисте пока нет видео</div>`;
  }

  renderItems();

  itemsEl.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const id = button.closest('[data-id]').dataset.id;
    const index = videos.findIndex((video) => video.id === id);

    if (button.dataset.action === 'remove') {
      await api.del(`/api/playlists/${playlist.id}/items/${id}`);
      videos.splice(index, 1);
      renderItems();
      return;
    }

    const target = button.dataset.action === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= videos.length) return;
    [videos[index], videos[target]] = [videos[target], videos[index]];
    renderItems();
    await api.post(`/api/playlists/${playlist.id}/reorder`, { order: videos.map((v) => v.id) });
  });

  document.getElementById('delete-btn')?.addEventListener('click', async () => {
    if (!confirm('Удалить плейлист? Видео останутся на месте.')) return;
    await api.del(`/api/playlists/${playlist.id}`);
    location.href = `/@${playlist.author.username}`;
  });

  document.getElementById('edit-btn')?.addEventListener('click', async () => {
    const title = prompt('Название плейлиста:', playlist.title);
    if (title === null) return;
    const visibility = prompt('Доступ: public, unlisted или private', playlist.visibility);
    try {
      await api.patch(`/api/playlists/${playlist.id}`, { title, visibility });
      location.reload();
    } catch (err) {
      alert(err.message);
    }
  });
})();
