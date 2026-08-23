(async function main() {
  await bootstrap();

  const videoId = location.pathname.split('/').filter(Boolean)[1];
  const player = document.getElementById('player');
  const shell = document.getElementById('player-shell');
  const statusBanner = document.getElementById('status-banner');
  const titleEl = document.getElementById('title');
  const barEl = document.getElementById('watch-bar');
  const descEl = document.getElementById('description-box');
  const relatedEl = document.getElementById('related');

  let video = null;
  let channel = null;
  let besyPlayer = null;
  let nextVideo = null;

  try {
    const data = await api.get(`/api/videos/${videoId}`);
    video = data.video;
    channel = data.channel;
    render(data.related);
  } catch (err) {
    console.error(err);
    document.getElementById('main-col').innerHTML =
      `<div class="empty"><div class="empty-icon">🚫</div>${escapeHtml(err.message)}</div>`;
    return;
  }

  function render(related) {
    document.title = `${video.title} — Besy`;
    titleEl.textContent = video.title;

    nextVideo = related[0] || null;

    besyPlayer = new BesyPlayer(shell, player, {
      videoId: video.id,
      onTheater: () => document.body.classList.toggle('theater'),
      onNext: () => { if (nextVideo) location.href = `/watch/${nextVideo.id}`; },
      onEnded: () => {
        if (autoplayEnabled() && nextVideo) location.href = `/watch/${nextVideo.id}`;
      },
    });
    besyPlayer.showNextButton(Boolean(nextVideo));
    window.besyPlayer = besyPlayer; // handy handle for debugging and tests
    besyPlayer.load({
      hlsUrl: video.hlsUrl,
      streamUrl: video.streamUrl,
      thumbUrl: video.thumbUrl,
      chapters: parseChapters(video.description),
    });
    renderStatusBanner();

    barEl.innerHTML = `
      <div class="channel-row">
        <a class="avatar" href="/@${escapeHtml(video.author.username)}">${initials(video.author.displayName)}</a>
        <div>
          <a href="/@${escapeHtml(video.author.username)}"><strong>${escapeHtml(video.author.displayName)}</strong></a>
          <div class="card-meta" id="subs-count">${fmt.count(channel.subscribers)} ${fmt.plural(channel.subscribers, 'подписчик', 'подписчика', 'подписчиков')}</div>
        </div>
        ${video.isOwner ? '' : `<button class="btn ${channel.subscribed ? 'active' : 'btn-primary'}" id="sub-btn">${channel.subscribed ? 'Вы подписаны' : 'Подписаться'}</button>`}
      </div>
      <div class="row">
        <button class="btn ${video.myReaction === 1 ? 'active' : ''}" id="like-btn">👍 <span>${fmt.count(video.likes)}</span></button>
        <button class="btn ${video.myReaction === -1 ? 'active' : ''}" id="dislike-btn">👎 <span>${fmt.count(video.dislikes)}</span></button>
        <button class="btn" id="share-btn">🔗 Поделиться</button>
        <a class="btn" href="/media/download/${video.id}">⬇ Скачать</a>
        ${video.isOwner ? '<a class="btn" href="/studio">✎ Управление</a>' : ''}
      </div>`;

    const stats = `${fmt.views(video.views)} · ${fmt.ago(video.createdAt)} · ${fmt.size(video.fileSize)}`;
    const tags = video.tags.length
      ? `<div class="tag-list">${video.tags.map((t) => `<a class="tag" href="/?q=${encodeURIComponent(t)}">#${escapeHtml(t)}</a>`).join('')}</div>`
      : '';
    descEl.innerHTML = `
      <div class="description">
        <div class="card-meta" style="margin-bottom:8px" id="stats-line">${stats}</div>
        <div class="description-text">${video.description ? escapeHtml(video.description) : '<span class="hint">Без описания</span>'}</div>
        ${tags}
      </div>`;

    relatedEl.innerHTML = related.length
      ? related.map((v) => `
        <a class="related-item" href="/watch/${v.id}">
          <div class="thumb">
            ${v.thumbUrl ? `<img src="${v.thumbUrl}" alt="" loading="lazy">` : '<div class="thumb-empty">▶</div>'}
            ${v.duration ? `<span class="duration">${fmt.duration(v.duration)}</span>` : ''}
          </div>
          <div>
            <div class="card-title">${escapeHtml(v.title)}</div>
            <div class="card-meta">${escapeHtml(v.author.displayName)}</div>
            <div class="card-meta">${fmt.views(v.views)} · ${fmt.ago(v.createdAt)}</div>
          </div>
        </a>`).join('')
      : '<div class="hint">Пока нечего показать</div>';

    wireActions();
  }

  function autoplayEnabled() {
    try { return localStorage.getItem('besy:autoplay') !== 'off'; } catch { return true; }
  }

  /** Shows transcoding progress and polls until the HLS ladder is ready. */
  function renderStatusBanner() {
    if (video.status === 'processing') {
      statusBanner.innerHTML = `
        <div class="status-banner">
          <span class="status-dot"></span>
          Идёт обработка видео — ${video.progress || 0}%. Пока доступно исходное качество,
          адаптивные версии появятся автоматически.
        </div>`;
      clearTimeout(window.__besyStatusTimer);
      window.__besyStatusTimer = setTimeout(pollStatus, 3000);
      return;
    }

    if (video.status === 'failed' && video.isOwner) {
      statusBanner.innerHTML = `
        <div class="status-banner">⚠ Не удалось подготовить адаптивные версии: ${escapeHtml(video.statusError || 'ошибка обработки')}.
        Видео доступно в исходном качестве.</div>`;
      return;
    }

    statusBanner.innerHTML = '';
  }

  async function pollStatus() {
    try {
      const { video: fresh } = await api.get(`/api/videos/${video.id}`);
      const becameReady = video.status === 'processing' && fresh.status !== 'processing';
      video.status = fresh.status;
      video.progress = fresh.progress;
      video.hlsUrl = fresh.hlsUrl;
      video.statusError = fresh.statusError;
      if (becameReady && fresh.hlsUrl) {
        // Swap to the adaptive ladder without losing the current position.
        const at = player.currentTime;
        const wasPlaying = !player.paused;
        await besyPlayer.load({
          hlsUrl: fresh.hlsUrl,
          streamUrl: fresh.streamUrl,
          thumbUrl: fresh.thumbUrl,
          chapters: parseChapters(video.description),
        });
        player.addEventListener('loadedmetadata', () => {
          player.currentTime = at;
          if (wasPlaying) player.play().catch(() => {});
        }, { once: true });
      }
      renderStatusBanner();
    } catch {
      renderStatusBanner();
    }
  }

  function wireActions() {
    document.getElementById('sub-btn')?.addEventListener('click', async (event) => {
      if (!auth.user) return auth.requireLogin();
      const btn = event.currentTarget;
      btn.disabled = true;
      try {
        const res = await api.post(`/api/channels/${video.author.username}/subscribe`);
        btn.textContent = res.subscribed ? 'Вы подписаны' : 'Подписаться';
        btn.classList.toggle('active', res.subscribed);
        btn.classList.toggle('btn-primary', !res.subscribed);
        document.getElementById('subs-count').textContent =
          `${fmt.count(res.subscribers)} ${fmt.plural(res.subscribers, 'подписчик', 'подписчика', 'подписчиков')}`;
      } finally {
        btn.disabled = false;
      }
    });

    const likeBtn = document.getElementById('like-btn');
    const dislikeBtn = document.getElementById('dislike-btn');

    async function react(value) {
      if (!auth.user) return auth.requireLogin();
      const next = video.myReaction === value ? 0 : value;
      const res = await api.post(`/api/videos/${video.id}/reaction`, { value: next });
      video.myReaction = res.myReaction;
      video.likes = res.likes;
      video.dislikes = res.dislikes;
      likeBtn.querySelector('span').textContent = fmt.count(res.likes);
      dislikeBtn.querySelector('span').textContent = fmt.count(res.dislikes);
      likeBtn.classList.toggle('active', res.myReaction === 1);
      dislikeBtn.classList.toggle('active', res.myReaction === -1);
    }

    likeBtn.addEventListener('click', () => react(1));
    dislikeBtn.addEventListener('click', () => react(-1));

    document.getElementById('share-btn').addEventListener('click', async (event) => {
      const url = location.href;
      try {
        await navigator.clipboard.writeText(url);
        event.currentTarget.textContent = '✓ Ссылка скопирована';
        setTimeout(() => { event.currentTarget.textContent = '🔗 Поделиться'; }, 2000);
      } catch {
        prompt('Скопируйте ссылку:', url);
      }
    });
  }

  /* Count a view once the visitor actually watched a bit: 3s, or a quarter of a short clip. */
  let viewCounted = false;
  player.addEventListener('timeupdate', async () => {
    const threshold = Math.min(3, (player.duration || 3) / 4);
    if (viewCounted || player.currentTime < threshold) return;
    viewCounted = true;
    try {
      const { views } = await api.post(`/api/videos/${video.id}/view`);
      video.views = views;
      const line = document.getElementById('stats-line');
      if (line) line.textContent = `${fmt.views(views)} · ${fmt.ago(video.createdAt)} · ${fmt.size(video.fileSize)}`;
    } catch { /* view counting is best-effort */ }
  });

  /* ------------------------------------------------------------- comments */

  const commentsEl = document.getElementById('comments');
  const formEl = document.getElementById('comment-form');

  formEl.innerHTML = auth.user
    ? `<form id="new-comment" style="margin-bottom:8px">
         <textarea class="input" name="body" rows="2" placeholder="Написать комментарий…" maxlength="2000"></textarea>
         <div class="row mt-16"><span class="spacer"></span><button class="btn btn-primary" type="submit">Отправить</button></div>
       </form>`
    : '<div class="hint" style="margin-bottom:12px"><a href="/auth" style="color:var(--accent)">Войдите</a>, чтобы оставить комментарий</div>';

  async function loadComments() {
    const { comments } = await api.get(`/api/videos/${video.id}/comments`);
    document.getElementById('comments-title').textContent =
      `${comments.length} ${fmt.plural(comments.length, 'комментарий', 'комментария', 'комментариев')}`;
    commentsEl.innerHTML = comments.length
      ? comments.map((c) => `
        <div class="comment" data-id="${c.id}">
          <a class="avatar" href="/@${escapeHtml(c.author.username)}">${initials(c.author.displayName)}</a>
          <div style="flex:1;min-width:0">
            <div class="comment-head">
              <a class="comment-author" href="/@${escapeHtml(c.author.username)}">${escapeHtml(c.author.displayName)}</a>
              <span class="comment-time">${fmt.ago(c.createdAt)}</span>
              ${c.isOwner || video.isOwner ? '<button class="comment-del" title="Удалить">✕</button>' : ''}
            </div>
            <div class="comment-body">${escapeHtml(c.body)}</div>
          </div>
        </div>`).join('')
      : '<div class="hint">Комментариев пока нет</div>';
  }

  document.getElementById('new-comment')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const textarea = event.target.body;
    const body = textarea.value.trim();
    if (!body) return;
    await api.post(`/api/videos/${video.id}/comments`, { body });
    textarea.value = '';
    loadComments();
  });

  commentsEl.addEventListener('click', async (event) => {
    const btn = event.target.closest('.comment-del');
    if (!btn) return;
    const id = btn.closest('.comment').dataset.id;
    if (!confirm('Удалить комментарий?')) return;
    await api.del(`/api/videos/${video.id}/comments/${id}`);
    loadComments();
  });

  loadComments();
})();
