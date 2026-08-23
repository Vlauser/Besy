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
  del: (url) => api.request('DELETE', url),
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
}

/** Renders one grid card for a video. */
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
          ${video.duration ? `<span class="duration">${fmt.duration(video.duration)}</span>` : ''}
        </div>
        <div class="card-title">${escapeHtml(video.title)}</div>
      </a>
      ${author}
      <div class="card-meta">${fmt.views(video.views)} · ${fmt.ago(video.createdAt)}</div>
    </div>`;
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
