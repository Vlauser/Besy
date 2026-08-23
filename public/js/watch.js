(async function main() {
  await bootstrap();

  const videoId = location.pathname.split('/').filter(Boolean)[1];
  const listId = new URLSearchParams(location.search).get('list');
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
  let queue = null;

  try {
    const data = await api.get(`/api/videos/${videoId}`);
    video = data.video;
    channel = data.channel;
    if (listId) {
      // Watching inside a playlist: the queue decides what plays next.
      queue = await api.get(`/api/playlists/${listId}`).catch(() => null);
    }
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

    nextVideo = queueNext() || related[0] || null;

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
        <button class="btn" id="save-btn">☰ Сохранить</button>
        <button class="btn" id="report-btn" title="Пожаловаться">⚑</button>
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

    const sidebar = document.querySelector('aside');
    if (queue) sidebar.insertAdjacentHTML('afterbegin', renderQueue());

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

  /** Next item after the current one inside the open playlist. */
  function queueNext() {
    if (!queue?.videos?.length) return null;
    const index = queue.videos.findIndex((item) => item.id === video.id);
    return index >= 0 ? queue.videos[index + 1] || null : queue.videos[0];
  }

  function renderQueue() {
    if (!queue?.videos?.length) return '';
    return `
      <div class="queue">
        <div class="queue-head">
          <strong>${escapeHtml(queue.playlist.title)}</strong>
          <div class="card-meta">
            <a href="/playlist/${queue.playlist.id}">${escapeHtml(queue.playlist.author.displayName)}</a> ·
            ${queue.videos.findIndex((item) => item.id === video.id) + 1} из ${queue.videos.length}
          </div>
        </div>
        <div class="queue-list">
          ${queue.videos.map((item, index) => `
            <a class="queue-item${item.id === video.id ? ' current' : ''}"
               href="/watch/${item.id}?list=${queue.playlist.id}">
              <span class="card-meta">${item.id === video.id ? '▶' : index + 1}</span>
              <div class="thumb">
                ${item.thumbUrl ? `<img src="${item.thumbUrl}" alt="" loading="lazy">` : '<div class="thumb-empty">▶</div>'}
              </div>
              <div>
                <div class="card-title" style="font-size:13px">${escapeHtml(item.title)}</div>
                <div class="card-meta">${escapeHtml(item.author.displayName)}</div>
              </div>
            </a>`).join('')}
        </div>
      </div>`;
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

    document.getElementById('save-btn').addEventListener('click', openPlaylistDialog);
    document.getElementById('report-btn').addEventListener('click', openReportDialog);

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

  /* ------------------------------------------------ playlists and reports */

  async function openPlaylistDialog() {
    if (!auth.user) return auth.requireLogin();

    const modal = openModal('Сохранить в плейлист', '<div class="hint">Загрузка…</div>');
    const { playlists } = await api.get(`/api/playlists/mine?videoId=${video.id}`);

    modal.body.innerHTML = `
      ${playlists.map((playlist) => `
        <label class="choice">
          <input type="checkbox" data-playlist="${playlist.id}" ${playlist.contains ? 'checked' : ''}>
          <span>${escapeHtml(playlist.title)}</span>
          <span class="spacer"></span>
          <span class="card-meta">${playlist.count} · ${playlist.visibility === 'private' ? 'приватный' : 'открытый'}</span>
        </label>`).join('') || '<div class="hint">У вас пока нет плейлистов</div>'}
      <form id="new-playlist" class="mt-16">
        <div class="field">
          <label for="pl-title">Новый плейлист</label>
          <input class="input" id="pl-title" name="title" maxlength="140" placeholder="Название">
        </div>
        <button class="btn btn-primary" type="submit">Создать и добавить</button>
      </form>`;

    modal.body.querySelectorAll('[data-playlist]').forEach((checkbox) => {
      checkbox.addEventListener('change', async () => {
        const id = checkbox.dataset.playlist;
        try {
          if (checkbox.checked) await api.post(`/api/playlists/${id}/items`, { videoId: video.id });
          else await api.del(`/api/playlists/${id}/items/${video.id}`);
        } catch (err) {
          checkbox.checked = !checkbox.checked;
          alert(err.message);
        }
      });
    });

    modal.body.querySelector('#new-playlist').addEventListener('submit', async (event) => {
      event.preventDefault();
      const title = event.target.title.value.trim();
      if (!title) return;
      try {
        await api.post('/api/playlists', { title, videoId: video.id });
        modal.close();
      } catch (err) {
        alert(err.message);
      }
    });
  }

  async function openReportDialog() {
    if (!auth.user) return auth.requireLogin();

    const { reasons } = await api.get('/api/moderation/reasons');
    const modal = openModal('Пожаловаться на видео', `
      <form id="report-form">
        ${reasons.map((reason, index) => `
          <label class="choice">
            <input type="radio" name="reason" value="${reason.id}" ${index === 0 ? 'checked' : ''}>
            <span>${escapeHtml(reason.label)}</span>
          </label>`).join('')}
        <div class="field mt-16">
          <label for="details">Подробности (необязательно)</label>
          <textarea class="input" id="details" name="details" rows="3" maxlength="1000"></textarea>
        </div>
        <button class="btn btn-primary btn-block" type="submit">Отправить жалобу</button>
      </form>
      <button class="btn btn-block mt-16" id="copyright-btn">Заявление о нарушении авторских прав</button>`);

    modal.body.querySelector('#report-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = new FormData(event.target);
      try {
        await api.post('/api/moderation/reports', {
          targetType: 'video',
          videoId: video.id,
          reason: form.get('reason'),
          details: form.get('details'),
        });
        modal.body.innerHTML = '<div class="alert alert-ok">Жалоба отправлена — модераторы её рассмотрят.</div>';
      } catch (err) {
        alert(err.message);
      }
    });

    modal.body.querySelector('#copyright-btn').addEventListener('click', () => {
      modal.close();
      openCopyrightDialog();
    });
  }

  function openCopyrightDialog() {
    const modal = openModal('Заявление о нарушении авторских прав', `
      <form id="copyright-form">
        <div class="field">
          <label for="claimantName">Ваше имя или название правообладателя</label>
          <input class="input" id="claimantName" name="claimantName" required maxlength="200">
        </div>
        <div class="field">
          <label for="claimantEmail">E-mail для связи</label>
          <input class="input" id="claimantEmail" name="claimantEmail" type="email" required maxlength="200">
        </div>
        <div class="field">
          <label for="work">Какое произведение нарушено</label>
          <input class="input" id="work" name="work" required maxlength="500">
        </div>
        <div class="field">
          <label for="statement">Опишите нарушение</label>
          <textarea class="input" id="statement" name="statement" rows="4" required maxlength="2000"></textarea>
        </div>
        <label class="choice">
          <input type="checkbox" name="confirmed" required>
          <span>Подтверждаю, что сведения достоверны и я вправе подать это заявление</span>
        </label>
        <button class="btn btn-primary btn-block mt-16" type="submit">Отправить заявление</button>
      </form>`, { wide: true });

    modal.body.querySelector('#copyright-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = new FormData(event.target);
      try {
        await api.post('/api/moderation/copyright', {
          videoId: video.id,
          claimantName: form.get('claimantName'),
          claimantEmail: form.get('claimantEmail'),
          work: form.get('work'),
          statement: form.get('statement'),
          confirmed: form.get('confirmed') === 'on',
        });
        modal.body.innerHTML = '<div class="alert alert-ok">Заявление принято и передано модераторам.</div>';
      } catch (err) {
        alert(err.message);
      }
    });
  }

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
