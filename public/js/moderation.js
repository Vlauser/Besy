(async function main() {
  await bootstrap();

  if (!auth.user) return auth.requireLogin('/moderation');
  if (!auth.user.isAdmin) {
    document.getElementById('content').innerHTML =
      `<div class="empty"><div class="empty-icon">${icon('lock', '', ICON_HERO)}</div>Раздел доступен только модераторам</div>`;
    document.getElementById('tabs').hidden = true;
    return;
  }

  const content = document.getElementById('content');
  const statsEl = document.getElementById('stats');
  let view = 'reports';

  async function renderStats() {
    const stats = await api.get('/api/moderation/stats');
    const tiles = [
      ['Открытых жалоб', stats.openReports],
      ['Заявлений о правах', stats.openClaims],
      ['Заблокировано видео', stats.blockedVideos],
      ['Заблокировано аккаунтов', stats.bannedUsers],
      ['Пользователей', stats.users],
      ['Видео', stats.videos],
    ];
    statsEl.innerHTML = tiles.map(([label, value]) => `
      <div class="panel" style="padding:12px 16px;min-width:150px">
        <div style="font-size:22px;font-weight:700">${fmt.count(value)}</div>
        <div class="card-meta">${label}</div>
      </div>`).join('');
  }

  async function renderReports() {
    const { reports } = await api.get('/api/moderation/reports');
    if (!reports.length) {
      content.innerHTML = `<div class="empty"><div class="empty-icon state-ok">${icon('check', '', ICON_HERO)}</div>Открытых жалоб нет</div>`;
      return;
    }

    content.innerHTML = reports.map((report) => `
      <div class="panel mt-16" data-report="${report.id}">
        <div class="row" style="justify-content:space-between">
          <strong>${escapeHtml(report.reasonLabel)}</strong>
          <span class="card-meta">${fmt.ago(report.createdAt)} · от ${escapeHtml(report.reporter || 'удалён')}</span>
        </div>
        ${report.targetType === 'comment'
          ? `<div class="description mt-16">Комментарий ${escapeHtml(report.commentAuthor || '')}:
               «${escapeHtml(report.commentBody || '')}»</div>`
          : `<div class="mt-16"><a href="/watch/${report.videoId}" target="_blank" rel="noopener">
               ${escapeHtml(report.videoTitle || report.videoId)}</a></div>`}
        ${report.details ? `<div class="hint mt-16">${escapeHtml(report.details)}</div>` : ''}
        <div class="row mt-16">
          ${report.targetType === 'video' ? `
            <button class="btn btn-danger" data-action="block" data-video="${report.videoId}">Заблокировать</button>
            <button class="btn btn-danger" data-action="strike" data-video="${report.videoId}">Блок + предупреждение</button>
            <button class="btn" data-action="age" data-video="${report.videoId}">18+</button>`
          : `<button class="btn btn-danger" data-action="del-comment" data-comment="${report.commentId}">Удалить комментарий</button>`}
          <span class="spacer"></span>
          <button class="btn" data-action="resolve">Закрыть</button>
          <button class="btn" data-action="dismiss">Отклонить</button>
        </div>
      </div>`).join('');
  }

  async function renderCopyright() {
    const { claims } = await api.get('/api/moderation/copyright');
    if (!claims.length) {
      content.innerHTML = `<div class="empty"><div class="empty-icon state-ok">${icon('check', '', ICON_HERO)}</div>Заявлений нет</div>`;
      return;
    }

    content.innerHTML = claims.map((claim) => `
      <div class="panel mt-16" data-claim="${claim.id}">
        <div class="row" style="justify-content:space-between">
          <strong>${escapeHtml(claim.claimantName)}</strong>
          <span class="card-meta">${fmt.ago(claim.createdAt)}</span>
        </div>
        <div class="card-meta">${escapeHtml(claim.claimantEmail)}</div>
        <div class="mt-16"><a href="/watch/${claim.videoId}" target="_blank" rel="noopener">
          ${escapeHtml(claim.videoTitle || claim.videoId)}</a></div>
        <div class="description mt-16"><strong>Произведение:</strong> ${escapeHtml(claim.work)}
          <div class="mt-16">${escapeHtml(claim.statement)}</div></div>
        <div class="row mt-16">
          <button class="btn btn-danger" data-action="accept">Удовлетворить (блок + предупреждение)</button>
          <button class="btn" data-action="reject">Отклонить</button>
        </div>
      </div>`).join('');
  }

  async function renderLog() {
    const { entries } = await api.get('/api/moderation/log');
    content.innerHTML = entries.length
      ? `<div class="panel">${entries.map((entry) => `
          <div class="row" style="gap:12px;padding:7px 0;border-bottom:1px solid var(--border)">
            <span class="card-meta" style="min-width:130px">${fmt.ago(entry.createdAt)}</span>
            <strong>${escapeHtml(entry.actor)}</strong>
            <span class="tag">${escapeHtml(entry.action)}</span>
            <span class="card-meta">${escapeHtml(entry.targetType)} ${escapeHtml(entry.targetId)}</span>
            <span class="card-meta">${escapeHtml(entry.details || '')}</span>
          </div>`).join('')}</div>`
      : '<div class="empty">Журнал пуст</div>';
  }

  const views = { reports: renderReports, copyright: renderCopyright, log: renderLog };

  async function refresh() {
    content.innerHTML = '<div class="hint">Загрузка…</div>';
    await Promise.all([renderStats(), views[view]()]);
  }

  document.getElementById('tabs').addEventListener('click', (event) => {
    const tab = event.target.closest('.tab');
    if (!tab) return;
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    view = tab.dataset.view;
    refresh();
  });

  content.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;

    const reportCard = button.closest('[data-report]');
    const claimCard = button.closest('[data-claim]');
    const action = button.dataset.action;

    try {
      if (action === 'block' || action === 'strike') {
        const reason = prompt('Причина блокировки:', 'Нарушение правил сообщества');
        if (reason === null) return;
        await api.post(`/api/moderation/videos/${button.dataset.video}/block`, {
          reason, strike: action === 'strike',
        });
      } else if (action === 'age') {
        await api.post(`/api/moderation/videos/${button.dataset.video}/age-restrict`, { restricted: true });
      } else if (action === 'del-comment') {
        await api.del(`/api/moderation/comments/${button.dataset.comment}`);
      } else if (action === 'resolve' || action === 'dismiss') {
        await api.post(`/api/moderation/reports/${reportCard.dataset.report}/resolve`, {
          status: action === 'dismiss' ? 'dismissed' : 'resolved',
          resolution: '',
        });
      } else if (action === 'accept' || action === 'reject') {
        await api.post(`/api/moderation/copyright/${claimCard.dataset.claim}/resolve`, {
          status: action === 'accept' ? 'accepted' : 'rejected',
        });
      }
      refresh();
    } catch (err) {
      alert(err.message);
    }
  });

  refresh();
})();
