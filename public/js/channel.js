(async function main() {
  await bootstrap();

  const username = decodeURIComponent(location.pathname.replace(/^\/@/, '').replace(/\/$/, ''));
  const headEl = document.getElementById('head');
  const gridEl = document.getElementById('grid');

  let channel;
  try {
    ({ channel } = await api.get(`/api/channels/${encodeURIComponent(username)}`));
  } catch (err) {
    headEl.innerHTML = `<div class="empty"><div class="empty-icon">🔍</div>${escapeHtml(err.message)}</div>`;
    return;
  }

  document.title = `${channel.displayName} — Besy`;

  headEl.innerHTML = `
    <div class="channel-head">
      <div class="avatar avatar-lg">${initials(channel.displayName)}</div>
      <div>
        <h1 style="margin-bottom:4px">${escapeHtml(channel.displayName)}</h1>
        <div class="channel-stats">
          @${escapeHtml(channel.username)} ·
          <span id="subs">${fmt.count(channel.subscribers)} ${fmt.plural(channel.subscribers, 'подписчик', 'подписчика', 'подписчиков')}</span> ·
          ${fmt.count(channel.videos)} ${fmt.plural(channel.videos, 'видео', 'видео', 'видео')} ·
          ${fmt.views(channel.views)}
        </div>
        ${channel.about ? `<div class="hint mt-16" style="max-width:640px;white-space:pre-wrap">${escapeHtml(channel.about)}</div>` : ''}
      </div>
      <span class="spacer"></span>
      ${channel.isOwner
        ? '<a class="btn" href="/studio">Управление каналом</a>'
        : `<button class="btn ${channel.subscribed ? 'active' : 'btn-primary'}" id="sub-btn">${channel.subscribed ? 'Вы подписаны' : 'Подписаться'}</button>`}
    </div>`;

  document.getElementById('sub-btn')?.addEventListener('click', async (event) => {
    if (!auth.user) return auth.requireLogin();
    const btn = event.currentTarget;
    btn.disabled = true;
    try {
      const res = await api.post(`/api/channels/${encodeURIComponent(channel.username)}/subscribe`);
      btn.textContent = res.subscribed ? 'Вы подписаны' : 'Подписаться';
      btn.classList.toggle('active', res.subscribed);
      btn.classList.toggle('btn-primary', !res.subscribed);
      document.getElementById('subs').textContent =
        `${fmt.count(res.subscribers)} ${fmt.plural(res.subscribers, 'подписчик', 'подписчика', 'подписчиков')}`;
    } finally {
      btn.disabled = false;
    }
  });

  const tabs = document.createElement('div');
  tabs.className = 'tabs';
  tabs.innerHTML = `
    <button class="tab active" data-view="videos">Видео</button>
    <button class="tab" data-view="playlists">Плейлисты</button>`;
  headEl.appendChild(tabs);

  async function showVideos() {
    const { videos } = await api.get(`/api/videos?channel=${encodeURIComponent(channel.username)}&limit=60`);
    gridEl.innerHTML = videos.length
      ? videos.map((v) => videoCard(v, { showAuthor: false })).join('')
      : '<div class="empty" style="grid-column:1/-1"><div class="empty-icon">🎬</div>На этом канале пока нет видео</div>';
  }

  async function showPlaylists() {
    const { playlists } = await api.get(`/api/playlists?channel=${encodeURIComponent(channel.username)}`);
    gridEl.innerHTML = playlists.length
      ? playlists.map((playlist) => `
        <div class="card">
          <a href="/playlist/${playlist.id}">
            <div class="thumb">
              ${playlist.cover ? `<img src="${playlist.cover}" alt="" loading="lazy">` : '<div class="thumb-empty">☰</div>'}
              <span class="badge">${playlist.count} ${fmt.plural(playlist.count, 'видео', 'видео', 'видео')}</span>
            </div>
            <div class="card-title">${escapeHtml(playlist.title)}</div>
          </a>
          <div class="card-meta">${playlist.visibility === 'public' ? 'Открытый' : playlist.visibility === 'unlisted' ? 'По ссылке' : 'Приватный'} · обновлён ${fmt.ago(playlist.updatedAt)}</div>
        </div>`).join('')
      : '<div class="empty" style="grid-column:1/-1"><div class="empty-icon">☰</div>Плейлистов пока нет</div>';
  }

  tabs.addEventListener('click', (event) => {
    const tab = event.target.closest('.tab');
    if (!tab) return;
    tabs.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    gridEl.innerHTML = '';
    (tab.dataset.view === 'playlists' ? showPlaylists : showVideos)();
  });

  showVideos();
})();
