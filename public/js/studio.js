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

  /* ---------------------------------------------------- content protection */

  async function renderRights() {
    const config = await api.get('/api/matching/policies');
    if (!config.enabled) return;

    const panel = document.getElementById('rights-panel');
    const box = document.getElementById('rights-content');
    panel.hidden = false;

    const [{ works }, { detections }, { claims }] = await Promise.all([
      api.get('/api/matching/works'),
      api.get('/api/matching/detections'),
      api.get('/api/matching/claims'),
    ]);

    const policyOptions = (selected) => config.policies
      .map((policy) => `<option value="${policy.id}"${policy.id === selected ? ' selected' : ''}>${escapeHtml(policy.label)}</option>`)
      .join('');

    box.innerHTML = `
      <p class="hint">Заявите своё видео как эталон — новые загрузки будут сверяться с ним
        по отпечатку видеоряда и аудиодорожки.</p>

      <form id="new-work" class="row" style="gap:8px;margin:14px 0">
        <select class="input" name="videoId" style="flex:1" required>
          <option value="">Выберите своё видео…</option>
        </select>
        <select class="input" name="policy" style="width:auto">${policyOptions('flag')}</select>
        <button class="btn btn-primary" type="submit">Заявить</button>
      </form>

      ${works.length ? `
        <h3 style="font-size:15px;margin:16px 0 8px">Мои эталоны</h3>
        ${works.map((work) => `
          <div class="row" style="gap:8px;padding:8px 0;border-bottom:1px solid var(--border)" data-work="${work.id}">
            <div style="flex:1;min-width:0">
              <div>${escapeHtml(work.title)}</div>
              <div class="card-meta">${fmt.duration(work.duration)} · совпадений: ${work.matches}
                ${work.active ? '' : ' · отключён'}</div>
            </div>
            <select class="input" style="width:auto;padding:6px 10px" data-action="policy">${policyOptions(work.policy)}</select>
            <button class="btn" data-action="toggle">${work.active ? 'Отключить' : 'Включить'}</button>
            <button class="btn btn-danger btn-icon" data-action="remove" title="Убрать">${icon('trash', 'Убрать')}</button>
          </div>`).join('')}` : ''}

      ${detections.length ? `
        <h3 style="font-size:15px;margin:18px 0 8px">Найденные совпадения</h3>
        ${detections.map((detection) => `
          <div class="row" style="gap:8px;padding:7px 0;border-bottom:1px solid var(--border)">
            <div style="flex:1;min-width:0">
              <a href="/watch/${detection.videoId}">${escapeHtml(detection.videoTitle || detection.videoId)}</a>
              <div class="card-meta">${escapeHtml(detection.uploader || '')} · ${escapeHtml(detection.kindLabel)}
                · ${fmt.duration(detection.secondsMatched)} · ${escapeHtml(detection.status)}</div>
            </div>
            ${['active', 'disputed', 'upheld'].includes(detection.status)
              ? `<button class="btn" data-release="${detection.id}">Снять заявку</button>` : ''}
          </div>`).join('')}` : ''}

      ${claims.length ? `
        <h3 style="font-size:15px;margin:18px 0 8px">Заявки на мои видео</h3>
        ${claims.map((claim) => `
          <div class="row" style="gap:8px;padding:7px 0;border-bottom:1px solid var(--border)">
            <div style="flex:1;min-width:0">
              <a href="/watch/${claim.videoId}">${escapeHtml(claim.videoTitle || claim.videoId)}</a>
              <div class="card-meta">«${escapeHtml(claim.workTitle)}» от ${escapeHtml(claim.owner || '')}
                · ${escapeHtml(claim.status)}</div>
            </div>
          </div>`).join('')}` : ''}`;

    // Only videos that are not references yet can be registered.
    const { videos } = await api.get(`/api/videos?channel=${encodeURIComponent(auth.user.username)}&limit=60`);
    const taken = new Set(works.map((work) => work.videoId));
    const select = box.querySelector('[name="videoId"]');
    for (const video of videos) {
      if (taken.has(video.id) || video.kind === 'live') continue;
      const option = document.createElement('option');
      option.value = video.id;
      option.textContent = video.title;
      select.appendChild(option);
    }

    box.querySelector('#new-work').addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = event.target.querySelector('button');
      button.disabled = true;
      button.textContent = 'Считаем отпечаток…';
      try {
        await api.post('/api/matching/works', {
          videoId: event.target.videoId.value,
          policy: event.target.policy.value,
        });
        renderRights();
      } catch (err) {
        notify(err.message, 'error');
        button.disabled = false;
        button.textContent = 'Заявить';
      }
    });

    box.querySelectorAll('[data-work] [data-action]').forEach((control) => {
      const workId = control.closest('[data-work]').dataset.work;
      const handler = async () => {
        try {
          if (control.dataset.action === 'policy') {
            await api.patch(`/api/matching/works/${workId}`, { policy: control.value });
          } else if (control.dataset.action === 'toggle') {
            await api.patch(`/api/matching/works/${workId}`, {
              active: control.textContent.trim() === 'Включить',
            });
          } else {
            if (!await confirmAction('Уже заведённые заявки останутся — новые загрузки перестанут сверяться.',
              { title: 'Удалить эталон?', confirmLabel: 'Удалить', danger: true })) return;
            await api.del(`/api/matching/works/${workId}`);
          }
          renderRights();
        } catch (err) {
          notify(err.message, 'error');
        }
      };
      control.addEventListener(control.dataset.action === 'policy' ? 'change' : 'click', handler);
    });

    box.querySelectorAll('[data-release]').forEach((button) => {
      button.addEventListener('click', async () => {
        if (!await confirmAction('Автор снова сможет распоряжаться видео без ограничений.',
          { title: 'Снять заявку?', confirmLabel: 'Снять' })) return;
        await api.post(`/api/matching/claims/${button.dataset.release}/release`, {});
        renderRights();
      });
    });
  }

  /* ------------------------------------------------------------ live */

  async function renderLive() {
    const config = await api.get('/api/live/config');
    if (!config.enabled) return;

    const panel = document.getElementById('live-panel');
    const box = document.getElementById('live-content');
    panel.hidden = false;

    const { streams } = await api.get('/api/live/mine');
    const STATUS = { idle: 'Ожидает подключения', live: 'В эфире', ended: 'Завершён' };

    box.innerHTML = `
      <form id="new-stream" class="row" style="gap:8px;margin-bottom:14px">
        <input class="input" name="title" maxlength="140" placeholder="Название эфира" style="flex:1" required>
        <button class="btn btn-primary" type="submit">Создать эфир</button>
      </form>
      ${streams.map((stream) => `
        <div class="panel" style="margin-bottom:10px" data-stream="${stream.id}">
          <div class="row" style="justify-content:space-between">
            <strong>${escapeHtml(stream.title)}</strong>
            <span class="tag">${STATUS[stream.liveStatus] || stream.liveStatus}</span>
          </div>
          <div class="field mt-16">
            <label>Сервер (RTMP)</label>
            <input class="input stream-key" value="${escapeHtml(stream.ingestUrl)}" readonly onclick="this.select()">
          </div>
          <div class="field">
            <label>Ключ трансляции — не показывайте его в эфире</label>
            <input class="input stream-key" type="password" value="${escapeHtml(stream.streamKey)}" readonly
                   onclick="this.type='text';this.select()">
          </div>
          <div class="row">
            <a class="btn" href="/watch/${stream.id}">Открыть страницу</a>
            <button class="btn" data-action="roll">Сменить ключ</button>
            ${stream.liveStatus === 'live' ? '<button class="btn btn-danger" data-action="stop">Завершить</button>' : ''}
          </div>
        </div>`).join('')}`;

    box.querySelector('#new-stream').addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        await api.post('/api/live', { title: event.target.title.value.trim() });
        renderLive();
      } catch (err) {
        notify(err.message, 'error');
      }
    });

    box.querySelectorAll('button[data-action]').forEach((button) => {
      button.addEventListener('click', async () => {
        const id = button.closest('[data-stream]').dataset.stream;
        try {
          if (button.dataset.action === 'roll') {
            if (!await confirmAction('Идущая трансляция оборвётся, и в OBS нужно будет вписать новый ключ.',
              { title: 'Сменить ключ?', confirmLabel: 'Сменить', danger: true })) return;
            await api.post(`/api/live/${id}/key`);
          } else {
            await api.post(`/api/live/${id}/stop`);
          }
          renderLive();
        } catch (err) {
          notify(err.message, 'error');
        }
      });
    });
  }

  async function loadVideos() {
    const { videos } = await api.get(`/api/videos?channel=${encodeURIComponent(auth.user.username)}&limit=60`);
    if (!videos.length) {
      gridEl.innerHTML = `<div class="empty" style="grid-column:1/-1"><div class="empty-icon">${icon('film', '', ICON_HERO)}</div>Вы ещё ничего не загрузили</div>`;
      return;
    }

    const processing = videos.some((v) => v.status === 'processing');

    gridEl.innerHTML = videos.map((v) => `
      <div data-id="${v.id}">
        <label class="choice" style="margin-bottom:8px">
          <input type="checkbox" class="bulk-check" value="${v.id}"> Выбрать
        </label>
        <a class="card" href="/watch/${v.id}">
          <div class="thumb">
            ${v.thumbUrl ? `<img src="${v.thumbUrl}" alt="" loading="lazy">` : `<div class="thumb-empty">${icon('play', '', 30)}</div>`}
            ${v.visibility !== 'public' ? `<span class="badge">${VISIBILITY_LABELS[v.visibility]}</span>` : ''}
            ${v.duration ? `<span class="duration">${fmt.duration(v.duration)}</span>` : ''}
          </div>
          <div class="card-title">${escapeHtml(v.title)}</div>
        </a>
        ${statusLine(v)}
        <div class="card-meta stat-row">${fmt.views(v.views)}<span class="stat">${icon('like')}${fmt.count(v.likes)}</span><span class="stat">${icon('comment')}${fmt.count(v.comments)}</span></div>
        <div class="card-meta">${fmt.ago(v.createdAt)} · ${fmt.size(v.fileSize)}</div>
        <div class="row mt-16">
          <select class="input" style="width:auto;padding:6px 10px" data-action="visibility">
            ${Object.entries(VISIBILITY_LABELS).map(([value, label]) =>
              `<option value="${value}"${v.visibility === value ? ' selected' : ''}>${label}</option>`).join('')}
          </select>
          <button class="btn" data-action="rename">${icon('edit')}Изменить</button>
          <button class="btn" data-action="captions">CC</button>
          <a class="btn btn-icon" href="/analytics?video=${v.id}" title="Аналитика">${icon('chart', 'Аналитика')}</a>
          <button class="btn btn-danger btn-icon" data-action="delete" title="Удалить">${icon('trash', 'Удалить')}</button>
        </div>
      </div>`).join('');

    clearTimeout(window.__besyStudioTimer);
    if (processing) window.__besyStudioTimer = setTimeout(loadVideos, 3000);
  }

  /** Keeps the studio in sync while the transcoder is still working. */
  function statusLine(video) {
    if (video.blocked) {
      return `<div class="card-meta state-bad">${icon('ban')}Заблокировано модерацией${
        video.blockedReason ? `: ${escapeHtml(video.blockedReason)}` : ''}</div>`;
    }
    if (video.status === 'processing') {
      return `<div class="card-meta"><span class="status-dot" style="display:inline-block;margin-right:6px"></span>Обработка — ${video.progress || 0}%</div>`;
    }
    if (video.status === 'failed') {
      return `<div class="card-meta state-warn" title="${escapeHtml(video.statusError || '')}">${icon('warning')}Без адаптивного качества</div>`;
    }
    if (video.publishAt && video.publishAt > Date.now()) {
      return `<div class="card-meta stat-row">${icon('history')}Публикация ${new Date(video.publishAt).toLocaleString('ru-RU')}</div>`;
    }
    if (video.renditions?.length) {
      return `<div class="card-meta state-ok">${icon('check')}${video.renditions.map((r) => r.name).join(' · ')}</div>`;
    }
    return '';
  }

  /** Bulk actions apply to every checked card at once. */
  function selectedIds() {
    return Array.from(gridEl.querySelectorAll('.bulk-check:checked')).map((box) => box.value);
  }

  function renderBulkBar() {
    const ids = selectedIds();
    let bar = document.getElementById('bulk-bar');
    if (!ids.length) {
      bar?.remove();
      return;
    }
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'bulk-bar';
      bar.className = 'bulk-bar';
      document.body.appendChild(bar);
      bar.addEventListener('click', onBulkAction);
    }
    bar.innerHTML = `
      <strong>Выбрано: ${ids.length}</strong>
      <select class="input" style="width:auto;padding:6px 10px" data-bulk="visibility">
        <option value="">Сменить доступ…</option>
        <option value="public">Публичное</option>
        <option value="unlisted">По ссылке</option>
        <option value="private">Приватное</option>
      </select>
      <button class="btn btn-danger" data-bulk="delete">Удалить</button>
      <button class="btn btn-ghost" data-bulk="clear">Снять выделение</button>`;
  }

  async function onBulkAction(event) {
    const control = event.target.closest('[data-bulk]');
    if (!control || control.dataset.bulk === 'visibility') return;
    const ids = selectedIds();

    if (control.dataset.bulk === 'clear') {
      gridEl.querySelectorAll('.bulk-check:checked').forEach((box) => { box.checked = false; });
      renderBulkBar();
      return;
    }

    if (control.dataset.bulk === 'delete') {
      if (!await confirmAction('Файлы, комментарии и статистика удалятся вместе с ними. Отменить нельзя.',
        { title: `Удалить ${ids.length} видео?`, confirmLabel: 'Удалить', danger: true })) return;
      for (const id of ids) await api.del(`/api/videos/${id}`);
      renderBulkBar();
      loadVideos();
    }
  }

  document.addEventListener('change', async (event) => {
    const bulkSelect = event.target.closest('[data-bulk="visibility"]');
    if (!bulkSelect || !bulkSelect.value) return;
    const ids = selectedIds();
    for (const id of ids) await api.patch(`/api/videos/${id}`, { visibility: bulkSelect.value });
    bulkSelect.value = '';
    loadVideos();
  });

  gridEl.addEventListener('change', async (event) => {
    if (event.target.classList.contains('bulk-check')) {
      renderBulkBar();
      return;
    }

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
      if (!await confirmAction('Файл, комментарии и статистика удалятся вместе с ним. Отменить нельзя.',
        { title: 'Удалить видео?', confirmLabel: 'Удалить', danger: true })) return;
      await api.del(`/api/videos/${id}`);
      loadVideos();
      return;
    }

    if (button.dataset.action === 'captions') {
      openCaptionManager(id);
      return;
    }

    if (button.dataset.action === 'rename') {
      // Both fields at once, prefilled with what is there: the old pair of
      // prompts asked for a description without showing the current one, so
      // the safe answer was always to cancel.
      const current = await api.get(`/api/videos/${id}`).catch(() => null);
      const modal = openModal('Изменить видео', `
        <form id="rename-form">
          <div class="field">
            <label for="rename-title">Название</label>
            <input class="input" id="rename-title" maxlength="200" required>
          </div>
          <div class="field">
            <label for="rename-description">Описание</label>
            <textarea class="input" id="rename-description" rows="5" maxlength="5000"></textarea>
          </div>
          <div class="dialog-actions">
            <button class="btn" type="button" data-close>Отмена</button>
            <button class="btn btn-primary" type="submit">Сохранить</button>
          </div>
        </form>`);

      modal.body.querySelector('#rename-title').value =
        current?.video?.title || card.querySelector('.card-title').textContent;
      modal.body.querySelector('#rename-description').value = current?.video?.description || '';

      modal.body.querySelector('#rename-form').addEventListener('submit', async (event) => {
        event.preventDefault();
        try {
          await api.patch(`/api/videos/${id}`, {
            title: modal.body.querySelector('#rename-title').value,
            description: modal.body.querySelector('#rename-description').value,
          });
          modal.close();
          loadVideos();
        } catch (err) {
          notify(err.message, 'error');
        }
      });
    }
  });

  /** Upload, replace and delete subtitle tracks for one video. */
  async function openCaptionManager(videoId) {
    const modal = openModal('Субтитры', '<div class="hint">Загрузка…</div>');
    const [{ captions }, { languages }] = await Promise.all([
      api.get(`/api/captions/${videoId}`),
      api.get('/api/captions/languages'),
    ]);

    modal.body.innerHTML = `
      ${captions.length
        ? captions.map((caption) => `
          <div class="row" style="justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--border)">
            <span>${escapeHtml(caption.label)} <span class="tag">${escapeHtml(caption.lang)}</span>
              ${caption.isDefault ? '<span class="tag">по умолчанию</span>' : ''}</span>
            <button class="btn btn-danger" data-caption="${caption.id}">Удалить</button>
          </div>`).join('')
        : '<div class="hint">Субтитров пока нет</div>'}
      <form id="caption-form" class="mt-24">
        <div class="field">
          <label for="cap-lang">Язык</label>
          <select class="input" id="cap-lang" name="lang">
            ${languages.map((lang) => `<option value="${lang.id}">${escapeHtml(lang.label)}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label for="cap-file">Файл .vtt или .srt</label>
          <input class="input" id="cap-file" name="file" type="file" accept=".vtt,.srt,text/vtt" required>
        </div>
        <label class="choice">
          <input type="checkbox" name="isDefault"> Включать по умолчанию
        </label>
        <button class="btn btn-primary btn-block mt-16" type="submit">Загрузить субтитры</button>
      </form>`;

    modal.body.querySelectorAll('[data-caption]').forEach((button) => {
      button.addEventListener('click', async () => {
        await api.del(`/api/captions/${videoId}/${button.dataset.caption}`);
        modal.close();
        openCaptionManager(videoId);
      });
    });

    modal.body.querySelector('#caption-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.target;
      const data = new FormData();
      data.append('file', form.file.files[0]);
      data.append('lang', form.lang.value);
      data.append('label', form.lang.options[form.lang.selectedIndex].text);
      data.append('isDefault', form.isDefault.checked ? 'true' : 'false');

      try {
        const res = await fetch(`/api/captions/${videoId}`, {
          method: 'POST',
          body: data,
          credentials: 'same-origin',
          headers: { 'X-CSRF-Token': readCookie('besy_csrf') },
        });
        const payload = await res.json();
        if (!res.ok) throw new Error(payload.error || 'Не удалось загрузить');
        modal.close();
        openCaptionManager(videoId);
      } catch (err) {
        notify(err.message, 'error');
      }
    });
  }

  loadVideos();
  renderLive().catch(() => {});
  renderRights().catch(() => {});
})();
