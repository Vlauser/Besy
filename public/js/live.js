(async function main() {
  await bootstrap();

  const grid = document.getElementById('grid');

  async function load() {
    const [{ streams }, config] = await Promise.all([
      api.get('/api/live'),
      api.get('/api/live/config'),
    ]);

    if (!config.enabled) {
      grid.innerHTML = `
        <div class="empty" style="grid-column:1/-1">
          <div class="empty-icon">${icon('live', '', ICON_HERO)}</div>
          Эфиры на этом сервере выключены.
          <div class="hint mt-16">Включаются переменной BESY_LIVE=on</div>
        </div>`;
      return;
    }

    grid.innerHTML = streams.length
      ? streams.map((stream) => `
        <div class="card">
          <a href="/watch/${stream.id}">
            <div class="thumb">
              ${stream.thumbUrl ? `<img src="${stream.thumbUrl}" alt="" loading="lazy">` : `<div class="thumb-empty">${icon('live', '', 30)}</div>`}
              <span class="live-badge">В эфире</span>
            </div>
            <div class="card-title">${escapeHtml(stream.title)}</div>
          </a>
          <div class="card-meta">
            <a href="/@${escapeHtml(stream.author.username)}">${escapeHtml(stream.author.displayName)}</a>
          </div>
          <div class="card-meta">начало ${fmt.ago(stream.createdAt)}</div>
        </div>`).join('')
      : `<div class="empty" style="grid-column:1/-1">
           <div class="empty-icon">${icon('live', '', ICON_HERO)}</div>Сейчас никто не транслирует
           <div class="mt-24"><a class="btn btn-primary" href="/studio">Начать свой эфир</a></div>
         </div>`;
  }

  load();
  // The list is short-lived by nature, so refresh it while the tab is open.
  setInterval(() => { if (!document.hidden) load().catch(() => {}); }, 20000);
})();
