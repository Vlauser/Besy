/* Shared helpers: API client, header rendering, formatting. */

function readCookie(name) {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : '';
}

/** The CSRF cookie is readable by design: it is echoed back in a header. */
function csrfHeader() {
  const token = readCookie('besy_csrf');
  return token ? { 'X-CSRF-Token': token } : {};
}

const api = {
  async request(method, url, body, options = {}) {
    const init = { method, headers: { ...csrfHeader() }, credentials: 'same-origin', ...options };
    if (body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const res = await fetch(url, init);
    const text = await res.text();
    const data = text ? JSON.parse(text) : {};
    if (!res.ok) {
      const error = new Error(data.error || `Ошибка ${res.status}`);
      error.status = res.status;
      error.data = data;
      throw error;
    }
    return data;
  },
  get: (url) => api.request('GET', url),
  post: (url, body) => api.request('POST', url, body),
  patch: (url, body) => api.request('PATCH', url, body),
  del: (url, body) => api.request('DELETE', url, body),
};

const fmt = {
  count(n) {
    n = Number(n) || 0;
    if (n < 1000) return String(n);
    if (n < 1e6) return `${(n / 1000).toFixed(n < 1e4 ? 1 : 0).replace('.0', '')} тыс.`;
    return `${(n / 1e6).toFixed(1).replace('.0', '')} млн`;
  },
  plural(n, one, few, many) {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
    return many;
  },
  views(n) {
    return `${fmt.count(n)} ${fmt.plural(Number(n) || 0, 'просмотр', 'просмотра', 'просмотров')}`;
  },
  duration(seconds) {
    const s = Math.max(0, Math.round(Number(seconds) || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const pad = (v) => String(v).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
  },
  ago(ts) {
    const diff = Math.max(0, Date.now() - Number(ts)) / 1000;
    const units = [
      [31536000, 'год', 'года', 'лет'],
      [2592000, 'месяц', 'месяца', 'месяцев'],
      [604800, 'неделю', 'недели', 'недель'],
      [86400, 'день', 'дня', 'дней'],
      [3600, 'час', 'часа', 'часов'],
      [60, 'минуту', 'минуты', 'минут'],
    ];
    for (const [secs, one, few, many] of units) {
      const value = Math.floor(diff / secs);
      if (value >= 1) return `${value} ${fmt.plural(value, one, few, many)} назад`;
    }
    return 'только что';
  },
  size(bytes) {
    const units = ['Б', 'КБ', 'МБ', 'ГБ'];
    let value = Number(bytes) || 0;
    let i = 0;
    while (value >= 1024 && i < units.length - 1) { value /= 1024; i += 1; }
    return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
  },
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

function initials(name) {
  return String(name || '?').trim().slice(0, 1).toUpperCase();
}

const auth = {
  user: null,
  async load() {
    try {
      const { user } = await api.get('/api/auth/me');
      auth.user = user;
    } catch {
      auth.user = null;
    }
    return auth.user;
  },
  async logout() {
    await api.post('/api/auth/logout');
    auth.user = null;
    location.href = '/';
  },
  requireLogin(returnTo = location.pathname + location.search) {
    location.href = `/auth?next=${encodeURIComponent(returnTo)}`;
  },
};

function renderHeader() {
  const query = new URLSearchParams(location.search).get('q') || '';
  const right = auth.user
    ? `
      <a class="btn btn-ghost hide-sm" href="/upload">↑ Загрузить</a>
      <a class="btn btn-ghost hide-sm" href="/studio">Мои видео</a>
      <button class="btn btn-ghost" id="bell-btn" title="Уведомления">🔔<span class="bell-dot" hidden></span></button>
      ${auth.user.isAdmin ? '<a class="btn btn-ghost" href="/moderation" title="Модерация">🛡</a>' : ''}
      <a class="btn btn-ghost" href="/settings" title="Аккаунт и безопасность">⚙</a>
      <a class="avatar" href="/@${escapeHtml(auth.user.username)}" title="${escapeHtml(auth.user.displayName)}">${initials(auth.user.displayName)}</a>
      <button class="btn btn-ghost" id="logout-btn">Выйти</button>`
    : `
      <a class="btn btn-ghost" href="/auth">Войти</a>
      <a class="btn btn-primary" href="/auth?mode=register">Регистрация</a>`;

  const header = document.createElement('header');
  header.className = 'header';
  header.innerHTML = `
    <a class="logo" href="/"><span class="logo-mark">▶</span><span>Besy</span></a>
    <a class="btn btn-ghost hide-sm" href="/shorts">Shorts</a>
    <a class="btn btn-ghost hide-sm" href="/live">Эфиры</a>
    <form class="search" id="search-form">
      <input name="q" placeholder="Поиск видео и каналов" value="${escapeHtml(query)}" autocomplete="off">
      <button type="submit" aria-label="Найти">Найти</button>
    </form>
    <div class="header-actions">${right}</div>`;

  document.body.prepend(header);

  header.querySelector('#search-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const value = new FormData(event.target).get('q').trim();
    location.href = value ? `/?q=${encodeURIComponent(value)}` : '/';
  });

  header.querySelector('#logout-btn')?.addEventListener('click', () => auth.logout());
  if (auth.user) setupNotifications(header);
}

/* --------------------------------------------------------- notifications */

const NOTIFICATION_TEXT = {
  new_video: (n) => `${n.actor?.displayName || 'Канал'} опубликовал: ${n.body}`,
  live_started: (n) => `${n.actor?.displayName || 'Канал'} начал эфир: ${n.body}`,
  comment: (n) => `${n.actor?.displayName || 'Кто-то'} прокомментировал «${n.videoTitle || ''}»: ${n.body}`,
  reply: (n) => `${n.actor?.displayName || 'Кто-то'} ответил вам: ${n.body}`,
  video_ready: (n) => n.body,
  video_blocked: (n) => `Видео «${n.videoTitle || ''}» заблокировано: ${n.body}`,
  strike: (n) => `Вы получили предупреждение: ${n.body}`,
  copyright: (n) => n.body,
};

function setupNotifications(header) {
  const button = header.querySelector('#bell-btn');
  const dot = button.querySelector('.bell-dot');
  let panel = null;

  async function refreshBadge() {
    try {
      const { unread } = await api.get('/api/me/notifications');
      dot.hidden = unread === 0;
      dot.textContent = unread > 9 ? '9+' : String(unread);
    } catch { /* not signed in any more */ }
  }

  button.addEventListener('click', async () => {
    if (panel) {
      panel.remove();
      panel = null;
      return;
    }

    const { notifications } = await api.get('/api/me/notifications');
    panel = document.createElement('div');
    panel.className = 'bell-panel';
    panel.innerHTML = `
      <div class="bell-head">
        <strong>Уведомления</strong>
        <button class="btn btn-ghost" data-mark>Отметить прочитанными</button>
      </div>
      <div class="bell-list">
        ${notifications.length ? notifications.map((notification) => {
          const text = (NOTIFICATION_TEXT[notification.type] || ((n) => n.body))(notification);
          const href = notification.videoId ? `/watch/${notification.videoId}` : '#';
          return `
            <a class="bell-item${notification.read ? '' : ' unread'}" href="${href}">
              <div>${escapeHtml(text)}</div>
              <div class="card-meta">${fmt.ago(notification.createdAt)}</div>
            </a>`;
        }).join('') : '<div class="hint" style="padding:14px">Пока ничего нового</div>'}
      </div>`;

    document.body.appendChild(panel);
    const rect = button.getBoundingClientRect();
    panel.style.top = `${rect.bottom + 8}px`;
    panel.style.right = `${Math.max(12, window.innerWidth - rect.right)}px`;

    panel.querySelector('[data-mark]')?.addEventListener('click', async (event) => {
      event.preventDefault();
      await api.post('/api/me/notifications/read', {});
      panel.querySelectorAll('.bell-item').forEach((item) => item.classList.remove('unread'));
      refreshBadge();
    });

    setTimeout(() => {
      document.addEventListener('click', function close(event) {
        if (panel && !panel.contains(event.target) && event.target !== button) {
          panel.remove();
          panel = null;
          document.removeEventListener('click', close);
        }
      });
    }, 0);
  });

  refreshBadge();
  setInterval(() => { if (!document.hidden) refreshBadge(); }, 60000);
}

/** Renders one grid card for a video. */
/*
 * The rendition ladder: which HLS qualities this file actually has. The
 * transcoder only builds rungs at or below the source height, so the stack
 * describes the source as much as the output. Hidden entirely for videos with
 * no ladder and nothing in flight — an empty stack would say nothing.
 */
const LADDER_HEIGHTS = [360, 480, 720, 1080];

function renditionLadder(video) {
  const have = new Set((video.renditions || []).map((r) => r.height));
  const working = video.status === 'processing';
  if (!have.size && !working) return '';

  const names = LADDER_HEIGHTS.filter((h) => have.has(h)).map((h) => `${h}p`);
  const label = working
    ? `Обрабатывается${names.length ? `, готово: ${names.join(', ')}` : ''}`
    : `Качество: ${names.join(', ')}`;

  const rungs = LADDER_HEIGHTS
    .map((h) => `<i class="rung${have.has(h) ? ' on' : ''}"></i>`)
    .join('');

  return `<span class="ladder${working ? ' working' : ''}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">${rungs}</span>`;
}

function videoCard(video, { showAuthor = true } = {}) {
  const thumb = video.thumbUrl
    ? `<img src="${video.thumbUrl}" alt="" loading="lazy">`
    : '<div class="thumb-empty">▶</div>';
  const badge = video.visibility && video.visibility !== 'public'
    ? `<span class="badge">${video.visibility === 'private' ? 'приватное' : 'по ссылке'}</span>`
    : '';
  const author = showAuthor
    ? `<div class="card-meta"><a href="/@${escapeHtml(video.author.username)}">${escapeHtml(video.author.displayName)}</a></div>`
    : '';

  // The channel link must live outside the card link: nested <a> is invalid HTML
  // and the parser would hoist everything after it out of the card.
  return `
    <div class="card">
      <a href="/watch/${video.id}">
        <div class="thumb">
          ${thumb}${badge}
          ${renditionLadder(video)}
          ${video.duration ? `<span class="duration">${fmt.duration(video.duration)}</span>` : ''}
        </div>
        <div class="card-title">${escapeHtml(video.title)}</div>
      </a>
      ${author}
      <div class="card-meta">${fmt.views(video.views)} · ${fmt.ago(video.createdAt)}</div>
    </div>`;
}

/**
 * The report dialog, shared by every surface that can be reported. `target` is
 * the payload the moderation API expects — {targetType:'video', videoId},
 * {targetType:'comment', commentId} or {targetType:'user', username} — so the
 * dialog itself stays ignorant of what is being reported.
 */
async function openReportDialog({ title = 'Пожаловаться', extra = '', onExtra, ...target } = {}) {
  if (!auth.user) return auth.requireLogin();

  const { reasons } = await api.get('/api/moderation/reasons');
  const modal = openModal(title, `
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
    </form>${extra}`);

  modal.body.querySelector('#report-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    try {
      await api.post('/api/moderation/reports', {
        ...target,
        reason: form.get('reason'),
        details: form.get('details'),
      });
      modal.body.innerHTML = '<div class="alert alert-ok">Жалоба отправлена — модераторы её рассмотрят.</div>';
    } catch (err) {
      alert(err.message);
    }
  });

  if (onExtra) onExtra(modal);
  return modal;
}

/** Minimal modal used by the report, copyright and playlist dialogs. */
function openModal(title, bodyHtml, { wide = false } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal${wide ? ' modal-wide' : ''}" role="dialog" aria-modal="true">
      <div class="modal-head">
        <strong>${escapeHtml(title)}</strong>
        <button class="player-btn" data-close aria-label="Закрыть">✕</button>
      </div>
      <div class="modal-body">${bodyHtml}</div>
    </div>`;

  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (event) => { if (event.key === 'Escape') close(); };

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay || event.target.closest('[data-close]')) close();
  });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);

  return { overlay, body: overlay.querySelector('.modal-body'), close };
}

async function bootstrap() {
  await auth.load();
  renderHeader();
}
