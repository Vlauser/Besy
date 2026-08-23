(async function main() {
  await bootstrap();

  if (!auth.user) return auth.requireLogin('/studio');

  const gridEl = document.getElementById('grid');
  const profileForm = document.getElementById('profile-form');
  const profileAlert = document.getElementById('profile-alert');

  profileForm.displayName.value = auth.user.displayName;
  profileForm.about.value = auth.user.about || '';

  profileForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    profileAlert.innerHTML = '';
    try {
      const { user } = await api.patch('/api/auth/me', {
        displayName: profileForm.displayName.value,
        about: profileForm.about.value,
      });
      auth.user = user;
      profileAlert.innerHTML = '<div class="alert alert-ok">Сохранено</div>';
    } catch (err) {
      profileAlert.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
    }
  });

  const VISIBILITY_LABELS = { public: 'Публичное', unlisted: 'По ссылке', private: 'Приватное' };

  async function loadVideos() {
    const { videos } = await api.get(`/api/videos?channel=${encodeURIComponent(auth.user.username)}&limit=60`);
    if (!videos.length) {
      gridEl.innerHTML = '<div class="empty" style="grid-column:1/-1"><div class="empty-icon">🎬</div>Вы ещё ничего не загрузили</div>';
      return;
    }

    gridEl.innerHTML = videos.map((v) => `
      <div data-id="${v.id}">
        <a class="card" href="/watch/${v.id}">
          <div class="thumb">
            ${v.thumbUrl ? `<img src="${v.thumbUrl}" alt="" loading="lazy">` : '<div class="thumb-empty">▶</div>'}
            ${v.visibility !== 'public' ? `<span class="badge">${VISIBILITY_LABELS[v.visibility]}</span>` : ''}
            ${v.duration ? `<span class="duration">${fmt.duration(v.duration)}</span>` : ''}
          </div>
          <div class="card-title">${escapeHtml(v.title)}</div>
        </a>
        <div class="card-meta">${fmt.views(v.views)} · 👍 ${fmt.count(v.likes)} · 💬 ${fmt.count(v.comments)}</div>
        <div class="card-meta">${fmt.ago(v.createdAt)} · ${fmt.size(v.fileSize)}</div>
        <div class="row mt-16">
          <select class="input" style="width:auto;padding:6px 10px" data-action="visibility">
            ${Object.entries(VISIBILITY_LABELS).map(([value, label]) =>
              `<option value="${value}"${v.visibility === value ? ' selected' : ''}>${label}</option>`).join('')}
          </select>
          <button class="btn" data-action="rename">✎ Изменить</button>
          <button class="btn btn-danger" data-action="delete">🗑</button>
        </div>
      </div>`).join('');
  }

  gridEl.addEventListener('change', async (event) => {
    const select = event.target.closest('[data-action="visibility"]');
    if (!select) return;
    const id = select.closest('[data-id]').dataset.id;
    await api.patch(`/api/videos/${id}`, { visibility: select.value });
    loadVideos();
  });

  gridEl.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const card = button.closest('[data-id]');
    const id = card.dataset.id;

    if (button.dataset.action === 'delete') {
      if (!confirm('Удалить видео безвозвратно?')) return;
      await api.del(`/api/videos/${id}`);
      loadVideos();
      return;
    }

    if (button.dataset.action === 'rename') {
      const currentTitle = card.querySelector('.card-title').textContent;
      const title = prompt('Новое название:', currentTitle);
      if (title === null) return;
      const description = prompt('Новое описание (оставьте пустым, чтобы очистить):', '');
      const payload = { title };
      if (description !== null) payload.description = description;
      try {
        await api.patch(`/api/videos/${id}`, payload);
        loadVideos();
      } catch (err) {
        alert(err.message);
      }
    }
  });

  loadVideos();
})();
