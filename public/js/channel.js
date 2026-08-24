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
        : `<button class="btn ${channel.subscribed ? 'active' : 'btn-primary'}" id="sub-btn">${channel.subscribed ? 'Вы подписаны' : 'Подписаться'}</button>
           <button class="btn btn-ghost" id="channel-report" title="Пожаловаться на канал">Пожаловаться</button>
           <button class="btn btn-ghost btn-danger" id="channel-block">Заблокировать</button>`}
    </div>`;

  // Blocking is the strongest thing one person can do to another here, so it
  // asks once and says exactly what it will do.
  document.getElementById('channel-block')?.addEventListener('click', async () => {
    if (!auth.user) return auth.requireLogin();
    const ok = confirm(
      `Заблокировать ${channel.username}?\n\n`
      + 'Этот канал больше не сможет комментировать ваши видео, писать в чат ваших '
      + 'эфиров и подписываться на вас. Взаимные подписки будут сняты. '
      + 'Пользователь об этом не узнает.',
    );
    if (!ok) return;
    try {
      await api.post('/api/me/blocks', { username: channel.username });
      alert(`${channel.username} заблокирован. Снять блокировку можно в настройках аккаунта.`);
      location.reload();
    } catch (err) {
      alert(err.message);
    }
  });

  document.getElementById('channel-report')?.addEventListener('click', () => {
    if (!auth.user) return auth.requireLogin();
    openReportDialog({ targetType: 'user', username: channel.username, title: `Жалоба на канал ${channel.username}` });
  });

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
    <button class="tab" data-view="playlists">Плейлисты</button>
    <button class="tab" data-view="posts">Сообщество</button>`;
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

  async function showPosts() {
    const { posts } = await api.get(`/api/posts?channel=${encodeURIComponent(channel.username)}`);

    gridEl.style.display = 'block';
    gridEl.innerHTML = `
      ${channel.isOwner ? `
        <form class="panel" id="new-post" style="margin-bottom:16px">
          <textarea class="input" name="body" rows="3" maxlength="2000"
                    placeholder="Поделитесь новостью с подписчиками…"></textarea>
          <div class="row mt-16"><span class="spacer"></span>
            <button class="btn btn-primary" type="submit">Опубликовать</button></div>
        </form>` : ''}
      ${posts.length ? posts.map((post) => `
        <div class="panel" style="margin-bottom:12px" data-post="${post.id}">
          <div class="row" style="gap:10px">
            <span class="avatar">${initials(post.author.displayName)}</span>
            <div>
              <strong>${escapeHtml(post.author.displayName)}</strong>
              <div class="card-meta">${fmt.ago(post.createdAt)}</div>
            </div>
            <span class="spacer"></span>
            ${post.isOwner ? '<button class="btn btn-ghost" data-action="delete">✕</button>' : ''}
          </div>
          <div class="description-text mt-16">${escapeHtml(post.body)}</div>
          <div class="row mt-16">
            <button class="btn${post.liked ? ' active' : ''}" data-action="like">👍 <span>${fmt.count(post.likes)}</span></button>
          </div>
        </div>`).join('') : '<div class="empty"><div class="empty-icon">💬</div>Записей пока нет</div>'}`;

    gridEl.querySelector('#new-post')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const body = event.target.body.value.trim();
      if (!body) return;
      try {
        await api.post('/api/posts', { body });
        showPosts();
      } catch (err) {
        alert(err.message);
      }
    });

    gridEl.querySelectorAll('[data-post] button[data-action]').forEach((button) => {
      button.addEventListener('click', async () => {
        const id = button.closest('[data-post]').dataset.post;
        try {
          if (button.dataset.action === 'delete') {
            if (!confirm('Удалить запись?')) return;
            await api.del(`/api/posts/${id}`);
            showPosts();
          } else {
            if (!auth.user) return auth.requireLogin();
            const res = await api.post(`/api/posts/${id}/like`);
            button.classList.toggle('active', res.liked);
            button.querySelector('span').textContent = fmt.count(res.likes);
          }
        } catch (err) {
          alert(err.message);
        }
      });
    });
  }

  const views = { videos: showVideos, playlists: showPlaylists, posts: showPosts };

  tabs.addEventListener('click', (event) => {
    const tab = event.target.closest('.tab');
    if (!tab) return;
    tabs.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    gridEl.innerHTML = '';
    gridEl.style.display = tab.dataset.view === 'posts' ? 'block' : '';
    views[tab.dataset.view]();
  });

  showVideos();
})();
