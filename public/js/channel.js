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

  const { videos } = await api.get(`/api/videos?channel=${encodeURIComponent(channel.username)}&limit=60`);
  gridEl.innerHTML = videos.length
    ? videos.map((v) => videoCard(v, { showAuthor: false })).join('')
    : '<div class="empty" style="grid-column:1/-1"><div class="empty-icon">🎬</div>На этом канале пока нет видео</div>';
})();
