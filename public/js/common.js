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
      <a class="btn btn-ghost hide-sm" href="/upload">${icon('upload')}Загрузить</a>
      <a class="btn btn-ghost hide-sm" href="/studio">Мои видео</a>
      <button class="btn btn-ghost btn-icon" id="bell-btn" title="Уведомления">${icon('bell', 'Уведомления')}<span class="bell-dot" hidden></span></button>
      ${auth.user.isAdmin ? `<a class="btn btn-ghost btn-icon" href="/moderation" title="Модерация">${icon('shield', 'Модерация')}</a>` : ''}
      <a class="btn btn-ghost btn-icon" href="/settings" title="Аккаунт и безопасность">${icon('settings', 'Аккаунт и безопасность')}</a>
      <a class="avatar" href="/@${escapeHtml(auth.user.username)}" title="${escapeHtml(auth.user.displayName)}">${initials(auth.user.displayName)}</a>
      <button class="btn btn-ghost" id="logout-btn">Выйти</button>`
    : `
      <a class="btn btn-ghost" href="/auth">Войти</a>
      <a class="btn btn-primary" href="/auth?mode=register">Регистрация</a>`;

  const header = document.createElement('header');
  header.className = 'header';
  header.innerHTML = `
    <a class="logo" href="/"><span class="logo-mark">${icon('play')}</span><span>Besy</span></a>
    <a class="btn btn-ghost hide-sm" href="/shorts">Shorts</a>
    <a class="btn btn-ghost hide-sm" href="/live">Эфиры</a>
    <form class="search" id="search-form">
      <input name="q" placeholder="Поиск видео и каналов" value="${escapeHtml(query)}" autocomplete="off">
      <button type="submit" aria-label="Найти">${icon('search', 'Найти')}</button>
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
 * One icon set, drawn on a single 20x20 grid with one stroke weight, inheriting
 * currentColor. Emoji were doing this job before, and every platform drew them
 * in its own style and weight, so a row of six actions read as six unrelated
 * pictures. These are deliberately plain — the instrument-panel register the
 * rest of the interface is in.
 */
const ICONS = {
  /* actions on a video */
  like:      '<path d="M6 9v9H3V9h3Zm0 0 4-6a2 2 0 0 1 2 2v3h4a2 2 0 0 1 2 2.4l-1.2 5A2 2 0 0 1 14.8 18H6"/>',
  dislike:   '<path d="M6 11V2H3v9h3Zm0 0 4 6a2 2 0 0 0 2-2v-3h4a2 2 0 0 0 2-2.4l-1.2-5A2 2 0 0 0 14.8 2H6"/>',
  share:     '<path d="M8.5 11.5 11.5 8.5M7.5 12.5 5 15a2.8 2.8 0 1 0 4 4l2.5-2.5M12.5 7.5 15 5a2.8 2.8 0 1 1 4 4l-2.5 2.5"/>',
  download:  '<path d="M10 3v10m0 0 4-4m-4 4-4-4M3 15v2h14v-2"/>',
  upload:    '<path d="M10 17V7m0 0 4 4m-4-4-4 4M3 3h14"/>',
  save:      '<path d="M3 5h10M3 10h10M3 15h6M15 10v6M12 13h6"/>',
  later:     '<path d="M5 3h10v15l-5-3.5L5 18V3Z"/>',
  report:    '<path d="M5 18V3m0 0h10l-2.5 3.5L15 10H5"/>',
  edit:      '<path d="M13.5 3.5a2.1 2.1 0 0 1 3 3L7 16l-4 1 1-4 9.5-9.5Z"/>',
  trash:     '<path d="M3.5 5.5h13M8 5.5V3h4v2.5M5.5 5.5 6.5 18h7l1-12.5M8.5 8.5v6.5M11.5 8.5v6.5"/>',
  comment:   '<path d="M17 11.5A2.5 2.5 0 0 1 14.5 14H7l-4 3.5v-11A2.5 2.5 0 0 1 5.5 4h9A2.5 2.5 0 0 1 17 6.5v5Z"/>',
  captions:  '<path d="M2.5 5.5h15v9h-15v-9ZM8 9.2A1.8 1.8 0 1 0 8 11M14.5 9.2A1.8 1.8 0 1 0 14.5 11"/>',

  /* player transport */
  play:      '<path d="M6 3.5 16.5 10 6 16.5v-13Z"/>',
  pause:     '<path d="M7 3.5v13M13 3.5v13"/>',
  next:      '<path d="M4.5 3.5 13 10l-8.5 6.5v-13ZM15.5 3.5v13"/>',
  volume:    '<path d="M3 7.5h3L10 4v12L6 12.5H3v-5ZM13 7.4a3.6 3.6 0 0 1 0 5.2M15.6 5a7 7 0 0 1 0 10"/>',
  volumeLow: '<path d="M3 7.5h3L10 4v12L6 12.5H3v-5ZM13 7.4a3.6 3.6 0 0 1 0 5.2"/>',
  mute:      '<path d="M3 7.5h3L10 4v12L6 12.5H3v-5ZM13 8l4 4M17 8l-4 4"/>',
  /* Sliders, not a cog: a cog turns to mush at 18px, spokes read as a sun. */
  settings:  '<path d="M3 6h7M14 6h3M3 14h3M10 14h7M12 6a2 2 0 1 0-4 0 2 2 0 0 0 4 0ZM8 14a2 2 0 1 0 4 0 2 2 0 0 0-4 0Z"/>',
  theater:   '<path d="M2.5 6h15v8h-15V6Z"/>',
  pip:       '<path d="M2.5 5h15v10h-15V5ZM10 10.5h6V15h-6v-4.5Z"/>',
  fullscreen:'<path d="M3 7.5V3h4.5M17 7.5V3h-4.5M3 12.5V17h4.5M17 12.5V17h-4.5"/>',

  /* navigation and status */
  bell:      '<path d="M10 3a4.5 4.5 0 0 1 4.5 4.5c0 4 1.5 5 1.5 5H4s1.5-1 1.5-5A4.5 4.5 0 0 1 10 3ZM8.3 15.5a1.8 1.8 0 0 0 3.4 0"/>',
  shield:    '<path d="M10 2.5 16.5 5v5c0 4-3 6.4-6.5 7.5C6.5 16.4 3.5 14 3.5 10V5L10 2.5Z"/>',
  history:   '<path d="M10 5.5V10l3 1.8M3.6 8.2A6.7 6.7 0 1 1 3.5 11M3.5 5v3.3h3.3"/>',
  search:    '<path d="M9 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12ZM13.4 13.4 17.5 17.5"/>',
  close:     '<path d="M5 5l10 10M15 5 5 15"/>',
  plus:      '<path d="M10 4v12M4 10h12"/>',
  minus:     '<path d="M4 10h12"/>',
  up:        '<path d="M10 16V4m0 0 5 5m-5-5-5 5"/>',
  down:      '<path d="M10 4v12m0 0 5-5m-5 5-5-5"/>',
  chart:     '<path d="M3 17h14M6 17V9.5M10 17V4.5M14 17v-9"/>',
  ban:       '<path d="M10 17.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15ZM4.7 4.7l10.6 10.6"/>',
  warning:   '<path d="M10 3 18 16.5H2L10 3ZM10 8v4M10 14.3v.2"/>',
  live:      '<path d="M10 11.6a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2ZM6.6 6.6a4.8 4.8 0 0 0 0 6.8M13.4 13.4a4.8 4.8 0 0 0 0-6.8M4.2 4.2a8.2 8.2 0 0 0 0 11.6M15.8 15.8a8.2 8.2 0 0 0 0-11.6"/>',
  check:     '<path d="M4 10.5 8 15l8-9"/>',

  /* empty-state illustrations, same grid at a larger size */
  film:      '<path d="M2.5 4.5h15v11h-15v-11ZM6 4.5v11M14 4.5v11M2.5 10h15M2.5 7.2h3.5M2.5 12.8h3.5M14 7.2h3.5M14 12.8h3.5"/>',
  inbox:     '<path d="M2.5 11.5 5 4.5h10l2.5 7v4h-15v-4ZM2.5 11.5H7a3 3 0 0 0 6 0h4.5"/>',
  compass:   '<path d="M10 17.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15ZM13 7l-1.8 4.2L7 13l1.8-4.2L13 7Z"/>',
  phone:     '<path d="M6 2.5h8v15H6v-15ZM8.8 15.4h2.4"/>',
  lock:      '<path d="M5.5 8.5h9v9h-9v-9ZM7.5 8.5V6a2.5 2.5 0 0 1 5 0v2.5"/>',
};

/** Size in px for an icon used as an empty-state illustration. */
const ICON_HERO = 44;

/**
 * Inline SVG icon. `title` gives it an accessible name; without one it is
 * decorative and hidden, because a labelled button would otherwise be read
 * twice. `size` is for the larger empty-state drawings.
 */
function icon(name, title = '', size = 18) {
  const path = ICONS[name];
  if (!path) return '';
  const stroke = size > 24 ? 1.3 : 1.7;
  return `<svg class="icon" viewBox="0 0 20 20" width="${size}" height="${size}" fill="none"
    stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round"
    ${title ? `role="img" aria-label="${escapeHtml(title)}"` : 'aria-hidden="true"'}>${path}</svg>`;
}

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
    : `<div class="thumb-empty">${icon('play', '', 30)}</div>`;
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
        <button class="player-btn" data-close aria-label="Закрыть">${icon('close', 'Закрыть')}</button>
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

/**
 * Hydrates icons declared in static markup as data-icon="name", so the HTML
 * files do not have to carry SVG paths that would then drift from the set.
 */
function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => {
    const svg = icon(el.dataset.icon, el.dataset.iconLabel || '', Number(el.dataset.iconSize) || 18);
    if (svg) el.insertAdjacentHTML('afterbegin', svg);
    el.removeAttribute('data-icon');
  });
}

async function bootstrap() {
  await auth.load();
  renderHeader();
  hydrateIcons();
}
