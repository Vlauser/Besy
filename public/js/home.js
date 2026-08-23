(async function main() {
  await bootstrap();

  const grid = document.getElementById('grid');
  const moreBtn = document.getElementById('more-btn');
  const title = document.getElementById('page-title');
  const query = new URLSearchParams(location.search).get('q') || '';

  const state = { sort: 'new', offset: 0, limit: 24, total: 0 };

  if (auth.user) {
    document.getElementById('tab-subs').hidden = false;
    document.getElementById('tab-foryou').hidden = false;
  }
  if (query) title.textContent = `Результаты: «${query}»`;

  function skeletons(n) {
    return Array.from({ length: n }, () => `
      <div>
        <div class="thumb skeleton"></div>
        <div class="skeleton" style="height:14px;width:80%;margin-bottom:6px"></div>
        <div class="skeleton" style="height:12px;width:50%"></div>
      </div>`).join('');
  }

  async function load({ reset = false } = {}) {
    if (reset) {
      state.offset = 0;
      grid.innerHTML = skeletons(8);
    }
    moreBtn.hidden = true;

    if (state.sort === 'foryou') {
      const { videos } = await api.get('/api/me/recommended');
      grid.innerHTML = videos.length
        ? videos.map((v) => videoCard(v)).join('')
        : '<div class="empty" style="grid-column:1/-1"><div class="empty-icon">✨</div>Посмотрите несколько роликов — и здесь появятся рекомендации</div>';
      return;
    }

    if (state.sort === 'subs') {
      const { videos } = await api.get('/api/channels/me/feed');
      grid.innerHTML = videos.length
        ? videos.map((v) => videoCard(v)).join('')
        : '<div class="empty" style="grid-column:1/-1"><div class="empty-icon">📭</div>Пока нет видео от каналов, на которые вы подписаны</div>';
      return;
    }

    const params = new URLSearchParams({
      sort: state.sort,
      limit: state.limit,
      offset: state.offset,
    });
    if (query) params.set('q', query);

    const data = await api.get(`/api/videos?${params}`);
    state.total = data.total;

    const html = data.videos.map((v) => videoCard(v)).join('');
    if (reset) {
      grid.innerHTML = html || `
        <div class="empty" style="grid-column:1/-1">
          <div class="empty-icon">🎬</div>
          ${query ? 'Ничего не найдено' : 'Пока нет ни одного видео — станьте первым!'}
        </div>`;
    } else {
      grid.insertAdjacentHTML('beforeend', html);
    }

    state.offset += data.videos.length;
    moreBtn.hidden = state.offset >= state.total;
  }

  document.getElementById('tabs').addEventListener('click', (event) => {
    const tab = event.target.closest('.tab');
    if (!tab) return;
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    state.sort = tab.dataset.sort;
    title.textContent = query
      ? `Результаты: «${query}»`
      : { new: 'Новые видео', popular: 'Популярное', subs: 'Подписки', foryou: 'Для вас' }[state.sort];
    load({ reset: true }).catch((err) => { grid.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`; });
  });

  moreBtn.addEventListener('click', () => load());

  load({ reset: true }).catch((err) => {
    grid.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
  });
})();
