(async function main() {
  await bootstrap();

  // A vertical video fills the screen, so the screen goes dark around it —
  // whatever theme the rest of the site is in.
  document.body.classList.add('on-dark');

  const feed = document.getElementById('feed');
  const state = { offset: 0, limit: 6, total: Infinity, loading: false };
  const players = new Map();

  function slide(video) {
    return `
      <section class="short" data-id="${video.id}">
        <div class="short-stage">
          <video playsinline loop preload="none" poster="${video.thumbUrl || ''}"></video>
          <div class="short-overlay">
            <div class="short-meta">
              <a class="row" href="/@${escapeHtml(video.author.username)}" style="gap:9px">
                <span class="avatar">${avatarInner(video.author)}</span>
                <strong>${escapeHtml(video.author.displayName)}</strong>
              </a>
              <div class="short-title">${escapeHtml(video.title)}</div>
              <div class="card-meta">${fmt.views(video.views)} · ${fmt.ago(video.createdAt)}</div>
            </div>
            <div class="short-actions">
              <button class="short-btn" data-action="like" title="Нравится">${icon('like', 'Нравится')}<span>${fmt.count(video.likes)}</span></button>
              <button class="short-btn" data-action="mute" title="Звук">${icon('mute', 'Звук')}</button>
              <a class="short-btn" href="/watch/${video.id}" title="Открыть страницу">${icon('share', 'Открыть страницу')}</a>
            </div>
          </div>
        </div>
      </section>`;
  }

  async function loadMore() {
    if (state.loading || state.offset >= state.total) return;
    state.loading = true;
    try {
      const data = await api.get(`/api/videos?kind=short&sort=new&limit=${state.limit}&offset=${state.offset}`);
      state.total = data.total;
      state.offset += data.videos.length;

      if (!data.videos.length && !feed.children.length) {
        feed.innerHTML = `
          <div class="empty" style="color:#fff">
            <div class="empty-icon">${icon('phone', '', ICON_HERO)}</div>
            Пока нет вертикальных видео.<br>Загрузите ролик в вертикальном формате короче минуты.
            <div class="mt-24"><a class="btn btn-primary" href="/upload">Загрузить</a></div>
          </div>`;
        return;
      }

      feed.insertAdjacentHTML('beforeend', data.videos.map(slide).join(''));
      feed.querySelectorAll('.short:not([data-observed])').forEach((node) => {
        node.dataset.observed = '1';
        observer.observe(node);
      });
    } finally {
      state.loading = false;
    }
  }

  /** Attaches a source only for the slide in view, so scrolling stays cheap. */
  function activate(node) {
    const id = node.dataset.id;
    const media = node.querySelector('video');
    if (!players.has(id)) {
      players.set(id, true);
      api.get(`/api/videos/${id}`).then(({ video }) => {
        if (video.hlsUrl && window.Hls?.isSupported()) {
          const hls = new window.Hls({ capLevelToPlayerSize: true });
          hls.loadSource(video.hlsUrl);
          hls.attachMedia(media);
          node.__hls = hls;
        } else {
          media.src = video.hlsUrl && media.canPlayType('application/vnd.apple.mpegurl')
            ? video.hlsUrl
            : video.streamUrl;
        }
        media.muted = true;
        media.play().catch(() => {});
      }).catch(() => {});
    } else {
      media.play().catch(() => {});
    }

    api.post(`/api/videos/${id}/view`).catch(() => {});
  }

  function deactivate(node) {
    node.querySelector('video').pause();
  }

  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting && entry.intersectionRatio > 0.6) activate(entry.target);
      else deactivate(entry.target);
    }
    const last = feed.lastElementChild;
    if (last && entries.some((entry) => entry.target === last && entry.isIntersecting)) loadMore();
  }, { threshold: [0, 0.6, 1] });

  feed.addEventListener('click', async (event) => {
    const button = event.target.closest('.short-btn[data-action]');
    if (!button) {
      const media = event.target.closest('video');
      if (media) media.paused ? media.play() : media.pause();
      return;
    }

    const node = button.closest('.short');
    if (button.dataset.action === 'mute') {
      const media = node.querySelector('video');
      media.muted = !media.muted;
      button.innerHTML = icon(media.muted ? 'mute' : 'volume', 'Звук');
      return;
    }

    if (button.dataset.action === 'like') {
      if (!auth.user) return auth.requireLogin('/shorts');
      const liked = button.classList.toggle('active');
      try {
        const res = await api.post(`/api/videos/${node.dataset.id}/reaction`, { value: liked ? 1 : 0 });
        button.querySelector('span').textContent = fmt.count(res.likes);
      } catch (err) {
        button.classList.toggle('active');
        notify(err.message, 'error');
      }
    }
  });

  document.addEventListener('keydown', (event) => {
    const current = Array.from(feed.children).find((node) => {
      const rect = node.getBoundingClientRect();
      return rect.top >= -50 && rect.top < window.innerHeight / 2;
    });
    if (!current) return;
    if (event.key === 'ArrowDown') current.nextElementSibling?.scrollIntoView({ behavior: 'smooth' });
    if (event.key === 'ArrowUp') current.previousElementSibling?.scrollIntoView({ behavior: 'smooth' });
  });

  loadMore();
})();
