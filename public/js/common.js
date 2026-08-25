/* Shared helpers: API client, header rendering, formatting. */

/*
 * Appearance, applied before anything is drawn.
 *
 * Two settings, both of them iOS 27's: which theme, and how transparent the
 * glass is — the phone has a slider from ultra clear to fully tinted, and this
 * is the same idea with three stops. They are per browser rather than per
 * account: it is a property of the screen you are looking at, not of you.
 */
const appearance = {
  read(key, fallback) {
    try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
  },
  write(key, value) {
    try { localStorage.setItem(key, value); } catch { /* private mode */ }
  },
  theme(value) {
    if (value) appearance.write('besy:theme', value);
    const chosen = value || appearance.read('besy:theme', 'system');
    if (chosen === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', chosen);
    return chosen;
  },
  glass(value) {
    if (value) appearance.write('besy:glass', value);
    const chosen = value || appearance.read('besy:glass', 'regular');
    if (chosen === 'regular') document.documentElement.removeAttribute('data-glass');
    else document.documentElement.setAttribute('data-glass', chosen);
    return chosen;
  },
};

appearance.theme();
appearance.glass();

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
  /** Multipart POST: fetch sets its own boundary, so no Content-Type here. */
  upload: (url, formData) => api.request('POST', url, undefined, { body: formData }),
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

/**
 * The inside of an avatar: the uploaded picture when there is one, the first
 * letter otherwise. Callers keep owning the element and its class, because an
 * avatar is a link in the header, a span in a comment and a div on a channel.
 */
function avatarInner(person) {
  const src = person && (person.avatar || person.avatarUrl);
  return src
    ? `<img src="${escapeHtml(src)}" alt="">`
    : initials(person && person.displayName);
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
  // On a phone everything except the bell moves to the tab bar or the profile
  // page, so the top of the screen carries the name of the place and one thing
  // to check — which is all Instagram keeps up there too.
  const right = auth.user
    ? `
      <a class="btn btn-ghost hide-sm" href="/upload">${icon('upload')}Загрузить</a>
      <a class="btn btn-ghost hide-sm" href="/studio">Мои видео</a>
      <button class="btn btn-ghost btn-icon" id="search-open" aria-label="Поиск">${icon('search', 'Поиск')}</button>
      <button class="btn btn-ghost btn-icon" id="bell-btn" title="Уведомления">${icon('bell', 'Уведомления')}<span class="bell-dot" hidden></span></button>
      ${auth.user.isAdmin ? `<a class="btn btn-ghost btn-icon hide-sm" href="/moderation" title="Модерация">${icon('shield', 'Модерация')}</a>` : ''}
      <a class="btn btn-ghost btn-icon hide-sm" href="/settings" title="Аккаунт и безопасность">${icon('settings', 'Аккаунт и безопасность')}</a>
      <a class="avatar hide-sm" href="/@${escapeHtml(auth.user.username)}" title="${escapeHtml(auth.user.displayName)}"
         aria-label="Мой канал — ${escapeHtml(auth.user.displayName)}">${avatarInner(auth.user)}</a>
      <button class="btn btn-ghost hide-sm" id="logout-btn">Выйти</button>`
    : `
      <button class="btn btn-ghost btn-icon" id="search-open" aria-label="Поиск">${icon('search', 'Поиск')}</button>
      <a class="btn btn-ghost hide-sm" href="/auth">Войти</a>
      <a class="btn btn-primary hide-sm" href="/auth?mode=register">Регистрация</a>`;

  const header = document.createElement('header');
  header.className = 'header';
  header.innerHTML = `
    <a class="logo" href="/" aria-label="Besy — на главную"><span class="logo-mark">${icon('play')}</span><span>Besy</span></a>
    <a class="btn btn-ghost hide-sm" href="/shorts">Shorts</a>
    <a class="btn btn-ghost hide-sm" href="/live">Эфиры</a>
    <form class="search" id="search-form">
      <input name="q" placeholder="Поиск видео и каналов" value="${escapeHtml(query)}" autocomplete="off">
      <button type="submit" aria-label="Найти">${icon('search', 'Найти')}</button>
    </form>
    <div class="header-actions">${right}</div>`;

  document.body.prepend(header);

  const search = (value) => { location.href = value ? `/?q=${encodeURIComponent(value)}` : '/'; };

  header.querySelector('#search-form').addEventListener('submit', (event) => {
    event.preventDefault();
    search(new FormData(event.target).get('q').trim());
  });

  // The field itself does not fit next to anything on a phone, so there it is
  // a button that raises a sheet with nothing in it but the field.
  header.querySelector('#search-open')?.addEventListener('click', () => {
    const modal = openModal('Поиск', `
      <form id="search-sheet">
        <div class="field">
          <input class="input" name="q" placeholder="Видео и каналы" autocomplete="off"
                 value="${escapeHtml(query)}" aria-label="Поиск видео и каналов">
        </div>
        <button class="btn btn-primary" type="submit" style="width:100%">Искать</button>
      </form>`);
    const field = modal.body.querySelector('input');
    modal.body.querySelector('form').addEventListener('submit', (event) => {
      event.preventDefault();
      search(field.value.trim());
    });
    field.focus();
  });

  header.querySelector('#logout-btn')?.addEventListener('click', () => auth.logout());
  if (auth.user) setupNotifications(header);
  watchScrollEdge();
  renderTabBar();
}

/*
 * The scroll edge. While the page is at the top the bar is nearly clear; the
 * moment content passes under it the bar goes uniform — full tint, hard blur,
 * one hairline — which is what iOS 27 replaced its soft gradient with, and for
 * the same reason: a gradient over a moving picture never settles.
 */
function watchScrollEdge() {
  let ticking = false;
  const apply = () => {
    document.body.classList.toggle('scrolled', window.scrollY > 4);
    ticking = false;
  };
  apply();
  window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(apply);
  }, { passive: true });
}

/*
 * On a phone the destinations move to the bottom, within reach of a thumb, and
 * the middle slot is the verb rather than a place. Signed out it is the way in,
 * because that is the only thing there is to do.
 */
function renderTabBar() {
  const here = location.pathname;
  const isHere = (path) => (path === '/' ? here === '/' : here.startsWith(path));
  const tab = (href, name, label) => `
    <a href="${href}" class="${isHere(href) ? 'active' : ''}"
       aria-label="${escapeHtml(label)}"${isHere(href) ? ' aria-current="page"' : ''}>
      ${icon(name, '', 22)}<span>${escapeHtml(label)}</span>
    </a>`;

  const middle = auth.user
    ? `<a href="/upload" class="tab-post" aria-label="Загрузить видео"><span>${icon('plus', '', 20)}</span></a>`
    : `<a href="/auth" class="tab-post" aria-label="Войти"><span>${icon('lock', '', 20)}</span></a>`;

  const bar = document.createElement('nav');
  bar.className = 'tabbar glass';
  bar.setAttribute('aria-label', 'Основная навигация');
  bar.innerHTML = `
    ${tab('/', 'compass', 'Лента')}
    ${tab('/shorts', 'film', 'Shorts')}
    ${middle}
    ${tab('/live', 'live', 'Эфиры')}
    ${auth.user
      ? tab(`/@${auth.user.username}`, 'user', 'Профиль')
      : tab('/auth', 'user', 'Аккаунт')}`;
  document.body.appendChild(bar);
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
  image:     '<path d="M3 4.5h14v11H3v-11Zm0 8 4-3.5 4 3.5 3-2.5 3 2.5"/><circle cx="7.2" cy="7.6" r="1.1"/>',
  film:      '<path d="M2.5 4.5h15v11h-15v-11ZM6 4.5v11M14 4.5v11M2.5 10h15M2.5 7.2h3.5M2.5 12.8h3.5M14 7.2h3.5M14 12.8h3.5"/>',
  inbox:     '<path d="M2.5 11.5 5 4.5h10l2.5 7v4h-15v-4ZM2.5 11.5H7a3 3 0 0 0 6 0h4.5"/>',
  user:      '<path d="M10 10.4a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z"/><path d="M3.8 17.2c.9-3.1 3.3-4.8 6.2-4.8s5.3 1.7 6.2 4.8"/>',
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
  // A vertical clip gets a vertical tile — the 3:4 Instagram moved its own grid
  // to — while landscape video keeps 16:9, because cropping it would hide the
  // picture rather than show more of it.
  return `
    <div class="card">
      <a href="/watch/${video.id}">
        <div class="thumb${video.isShort ? ' thumb-tall' : ''}">
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
      notify(err.message, 'error');
    }
  });

  if (onExtra) onExtra(modal);
  return modal;
}

/**
 * Minimal modal used by the report, copyright and playlist dialogs.
 *
 * onClose fires however the modal goes away — button, backdrop or Escape — so
 * a dialog waiting on an answer always gets one instead of leaving its promise
 * hanging when the person presses Escape.
 */
function openModal(title, bodyHtml, { wide = false, onClose } = {}) {
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
    onClose?.();
  };
  const onKey = (event) => { if (event.key === 'Escape') close(); };

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay || event.target.closest('[data-close]')) close();
  });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);

  return { overlay, body: overlay.querySelector('.modal-body'), close };
}

/*
 * Dialogs and notices, on the same modal the rest of the interface uses.
 *
 * The browser's own confirm() and alert() were doing this job, and they arrive
 * in the operating system's dress rather than the product's, block the whole
 * page, and cannot say which of two things a destructive button will do. These
 * return promises so callers read the same as before: `if (!await confirmAction(…)) return;`
 */

/** Asks once. Resolves true only when the confirming button is pressed. */
function confirmAction(message, { title = 'Подтвердите', confirmLabel = 'Продолжить', danger = false } = {}) {
  return new Promise((resolve) => {
    let decided = false;
    const modal = openModal(title, `
      <p class="dialog-text">${escapeHtml(message).replace(/\n/g, '<br>')}</p>
      <div class="dialog-actions">
        <button class="btn" data-dialog="cancel">Отмена</button>
        <button class="btn ${danger ? 'btn-danger-solid' : 'btn-primary'}" data-dialog="ok">${escapeHtml(confirmLabel)}</button>
      </div>`, { onClose: () => finish(false) });

    const finish = (value) => {
      if (decided) return;
      decided = true;
      resolve(value);
      modal.close();
    };

    modal.body.querySelector('[data-dialog="ok"]').addEventListener('click', () => finish(true));
    modal.body.querySelector('[data-dialog="cancel"]').addEventListener('click', () => finish(false));
    modal.overlay.addEventListener('click', (event) => {
      // Dismissing by backdrop or Escape is a decision too, and it is "no".
      if (event.target === modal.overlay) finish(false);
    });
    modal.body.querySelector('[data-dialog="ok"]').focus();
  });
}

/** Asks for one line of text. Resolves null when dismissed. */
function promptAction(message, { title = 'Введите значение', value = '', confirmLabel = 'Сохранить', multiline = false, maxLength = 500 } = {}) {
  return new Promise((resolve) => {
    let decided = false;
    const field = multiline
      ? `<textarea class="input" id="dialog-input" rows="4" maxlength="${maxLength}">${escapeHtml(value)}</textarea>`
      : `<input class="input" id="dialog-input" value="${escapeHtml(value)}" maxlength="${maxLength}">`;

    const modal = openModal(title, `
      <form id="dialog-form">
        <div class="field">
          <label for="dialog-input">${escapeHtml(message)}</label>
          ${field}
        </div>
        <div class="dialog-actions">
          <button class="btn" type="button" data-dialog="cancel">Отмена</button>
          <button class="btn btn-primary" type="submit">${escapeHtml(confirmLabel)}</button>
        </div>
      </form>`, { onClose: () => finish(null) });

    const finish = (result) => {
      if (decided) return;
      decided = true;
      resolve(result);
      modal.close();
    };

    const input = modal.body.querySelector('#dialog-input');
    modal.body.querySelector('#dialog-form').addEventListener('submit', (event) => {
      event.preventDefault();
      finish(input.value);
    });
    modal.body.querySelector('[data-dialog="cancel"]').addEventListener('click', () => finish(null));
    modal.overlay.addEventListener('click', (event) => {
      if (event.target === modal.overlay) finish(null);
    });
    input.focus();
    input.select();
  });
}

/*
 * Choosing the frame, instead of accepting whatever the file happened to be.
 *
 * The avatar is a circle and the banner is a 6:1 strip; a photo is neither, so
 * before this the browser cropped by object-fit and the person uploading found
 * out afterwards which half of their picture survived. This picks the frame
 * first: drag to move, wheel or the slider to zoom, and what the viewport shows
 * is exactly what gets encoded — the same source rectangle feeds the preview
 * and the export.
 *
 * It runs entirely in the page. The server still sniffs the bytes it receives,
 * because a cropper on this side is a convenience and never a check.
 */

const ARTWORK = {
  avatar: {
    aspect: 1,
    outWidth: 512,
    round: true,
    title: 'Аватар канала',
    hint: 'Аватар везде показывается кругом — всё, что вне круга, обрежется.',
  },
  thumb: {
    aspect: 16 / 9,
    outWidth: 1280,
    round: false,
    // Covers are stored and served as JPEG, and nothing about a cover needs a
    // transparent corner.
    jpegOnly: true,
    title: 'Обложка видео',
    hint: 'Обложка стоит в ленте, в поиске и в плеере до нажатия — пропорции 16:9.',
  },
  banner: {
    aspect: 6,
    outWidth: 2048,
    round: false,
    title: 'Шапка канала',
    hint: 'Шапка растягивается на всю ширину страницы, пропорции 6:1.',
  },
};

/** Decodes a picked file, or rejects if the bytes are not an image at all. */
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Не удалось прочитать изображение')); };
    image.src = url;
  });
}

function toBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Opens the crop dialog. Resolves with a Blob to upload, or null if dismissed.
 *
 * `kind` is a key of ARTWORK; everything about shape and output size comes from
 * there, so the two call sites differ only by that string.
 */
async function openCropper(file, kind) {
  const spec = ARTWORK[kind];
  const image = await loadImage(file);
  if (!image.naturalWidth || !image.naturalHeight) throw new Error('Изображение пустое');

  return new Promise((resolve) => {
    let decided = false;
    const modal = openModal(spec.title, `
      <div class="cropper">
        <div class="cropper-stage${spec.round ? ' is-round' : ''}" style="aspect-ratio:${spec.aspect}"
             tabindex="0" role="application"
             aria-label="Область кадрирования: перетащите изображение, стрелки двигают, плюс и минус меняют масштаб">
          <canvas></canvas>
          <div class="cropper-mask" aria-hidden="true"></div>
        </div>
        <div class="cropper-zoom">
          <button class="btn btn-ghost btn-icon" type="button" data-zoom="out" aria-label="Отдалить">${icon('minus', 'Отдалить')}</button>
          <input type="range" min="0" max="1000" value="0" aria-label="Масштаб">
          <button class="btn btn-ghost btn-icon" type="button" data-zoom="in" aria-label="Приблизить">${icon('plus', 'Приблизить')}</button>
        </div>
        <p class="hint">${escapeHtml(spec.hint)}</p>
        <div class="dialog-actions">
          <button class="btn" type="button" data-crop="cancel">Отмена</button>
          <button class="btn" type="button" data-crop="reset">Сбросить</button>
          <button class="btn btn-primary" type="button" data-crop="save">Сохранить</button>
        </div>
      </div>`, { wide: spec.aspect > 2, onClose: () => finish(null) });

    const stage = modal.body.querySelector('.cropper-stage');
    const canvas = stage.querySelector('canvas');
    const ctx = canvas.getContext('2d');
    const zoom = modal.body.querySelector('input[type="range"]');
    const save = modal.body.querySelector('[data-crop="save"]');

    // Viewport size in CSS pixels; scale converts image pixels to those. cx/cy
    // is the point of the image sitting at the middle of the viewport, which is
    // the one pair of numbers that survives a resize unchanged.
    let vw = 0;
    let vh = 0;
    let scale = 1;
    let minScale = 1;
    let cx = image.naturalWidth / 2;
    let cy = image.naturalHeight / 2;
    const ZOOM_RANGE = 8;

    const clamp = (value, low, high) => (low > high ? (low + high) / 2 : Math.min(Math.max(value, low), high));

    function clampCenter() {
      const halfW = vw / (2 * scale);
      const halfH = vh / (2 * scale);
      cx = clamp(cx, halfW, image.naturalWidth - halfW);
      cy = clamp(cy, halfH, image.naturalHeight - halfH);
    }

    function draw() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(vw * dpr);
      canvas.height = Math.round(vh * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, vw, vh);
      ctx.imageSmoothingQuality = 'high';
      const sw = vw / scale;
      const sh = vh / scale;
      ctx.drawImage(image, cx - sw / 2, cy - sh / 2, sw, sh, 0, 0, vw, vh);
      zoom.value = String(Math.round((Math.log(scale / minScale) / Math.log(ZOOM_RANGE)) * 1000));
    }

    /** Zooms so the image point under (px, py) stays under (px, py). */
    function zoomAt(next, px = vw / 2, py = vh / 2) {
      const target = clamp(next, minScale, minScale * ZOOM_RANGE);
      const ix = cx + (px - vw / 2) / scale;
      const iy = cy + (py - vh / 2) / scale;
      scale = target;
      cx = ix - (px - vw / 2) / scale;
      cy = iy - (py - vh / 2) / scale;
      clampCenter();
      draw();
    }

    function measure(reset = false) {
      const rect = stage.getBoundingClientRect();
      if (!rect.width) return;
      vw = rect.width;
      vh = rect.height;
      canvas.style.width = `${vw}px`;
      canvas.style.height = `${vh}px`;
      // Cover: the smallest scale that leaves no empty corner.
      const previous = minScale;
      minScale = Math.max(vw / image.naturalWidth, vh / image.naturalHeight);
      scale = reset ? minScale : clamp(scale * (minScale / previous), minScale, minScale * ZOOM_RANGE);
      clampCenter();
      draw();
    }

    // Dragging, with two fingers pinching the same way the wheel zooms.
    const pointers = new Map();
    let pinch = null;

    stage.addEventListener('pointerdown', (event) => {
      stage.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y), scale };
      }
      stage.classList.add('is-dragging');
    });

    stage.addEventListener('pointermove', (event) => {
      const previous = pointers.get(event.pointerId);
      if (!previous) return;
      const next = { x: event.clientX, y: event.clientY };
      pointers.set(event.pointerId, next);

      if (pointers.size === 2 && pinch) {
        const [a, b] = [...pointers.values()];
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch.distance > 0) {
          const rect = stage.getBoundingClientRect();
          zoomAt(pinch.scale * (distance / pinch.distance),
            (a.x + b.x) / 2 - rect.left, (a.y + b.y) / 2 - rect.top);
        }
        return;
      }
      if (pointers.size !== 1) return;
      cx -= (next.x - previous.x) / scale;
      cy -= (next.y - previous.y) / scale;
      clampCenter();
      draw();
    });

    const release = (event) => {
      pointers.delete(event.pointerId);
      if (pointers.size < 2) pinch = null;
      if (!pointers.size) stage.classList.remove('is-dragging');
    };
    stage.addEventListener('pointerup', release);
    stage.addEventListener('pointercancel', release);

    stage.addEventListener('wheel', (event) => {
      event.preventDefault();
      const rect = stage.getBoundingClientRect();
      zoomAt(scale * Math.exp(-event.deltaY * 0.0015), event.clientX - rect.left, event.clientY - rect.top);
    }, { passive: false });

    stage.addEventListener('keydown', (event) => {
      const step = 24 / scale;
      const moves = {
        ArrowLeft: () => { cx -= step; }, ArrowRight: () => { cx += step; },
        ArrowUp: () => { cy -= step; }, ArrowDown: () => { cy += step; },
      };
      if (moves[event.key]) {
        event.preventDefault();
        moves[event.key]();
        clampCenter();
        draw();
      } else if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        zoomAt(scale * 1.2);
      } else if (event.key === '-' || event.key === '_') {
        event.preventDefault();
        zoomAt(scale / 1.2);
      }
    });

    zoom.addEventListener('input', () => {
      zoomAt(minScale * (ZOOM_RANGE ** (Number(zoom.value) / 1000)));
    });
    modal.body.querySelector('[data-zoom="in"]').addEventListener('click', () => zoomAt(scale * 1.3));
    modal.body.querySelector('[data-zoom="out"]').addEventListener('click', () => zoomAt(scale / 1.3));
    modal.body.querySelector('[data-crop="reset"]').addEventListener('click', () => {
      cx = image.naturalWidth / 2;
      cy = image.naturalHeight / 2;
      measure(true);
    });

    const finish = (value) => {
      if (decided) return;
      decided = true;
      observer.disconnect();
      resolve(value);
      modal.close();
    };

    modal.body.querySelector('[data-crop="cancel"]').addEventListener('click', () => finish(null));
    modal.overlay.addEventListener('click', (event) => {
      if (event.target === modal.overlay) finish(null);
    });

    save.addEventListener('click', async () => {
      save.disabled = true;
      try {
        finish(await encode());
      } catch (err) {
        save.disabled = false;
        notify(err.message || 'Не удалось обработать изображение', 'error');
      }
    });

    /*
     * Encodes the visible rectangle. PNG sources stay PNG so a logo keeps its
     * transparency; everything else becomes JPEG over white, because a JPEG
     * cannot hold an alpha channel and would otherwise fill it with black.
     * Quality steps down until the result fits the upload limit.
     */
    async function encode() {
      const sw = vw / scale;
      const sh = vh / scale;
      const width = Math.max(64, Math.min(spec.outWidth, Math.round(sw)));
      const out = document.createElement('canvas');
      out.width = width;
      out.height = Math.max(1, Math.round(width / spec.aspect));

      const g = out.getContext('2d');
      g.imageSmoothingQuality = 'high';
      const png = file.type === 'image/png' && !spec.jpegOnly;
      if (!png) {
        g.fillStyle = '#ffffff';
        g.fillRect(0, 0, out.width, out.height);
      }
      g.drawImage(image, cx - sw / 2, cy - sh / 2, sw, sh, 0, 0, out.width, out.height);

      const limit = 4 * 1024 * 1024;
      if (png) {
        const blob = await toBlob(out, 'image/png');
        if (blob && blob.size <= limit) return blob;
      }
      for (const quality of [0.92, 0.82, 0.7, 0.55]) {
        const blob = await toBlob(out, 'image/jpeg', quality);
        if (blob && blob.size <= limit) return blob;
      }
      throw new Error('Изображение слишком тяжёлое даже после сжатия');
    }

    const observer = new ResizeObserver(() => measure());
    observer.observe(stage);
    measure(true);
    stage.focus();
  });
}

/**
 * The whole pick-crop-upload path behind one call, so the channel page keeps
 * the file input and nothing else.
 */
async function uploadArtwork(kind, file) {
  const blob = await openCropper(file, kind);
  if (!blob) return false;
  const form = new FormData();
  form.append('image', blob, `${kind}.${blob.type === 'image/png' ? 'png' : 'jpg'}`);
  await api.upload(`/api/branding/${kind}`, form);
  return true;
}

/**
 * A notice that does not need answering. Stacks in the corner and leaves on its
 * own, so a failed save no longer stops the page until someone clicks OK.
 */
function notify(message, kind = 'info', { timeout = 5000 } = {}) {
  let host = document.querySelector('.toast-host');
  if (!host) {
    host = document.createElement('div');
    host.className = 'toast-host';
    host.setAttribute('role', 'status');
    host.setAttribute('aria-live', 'polite');
    document.body.appendChild(host);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${kind}`;
  toast.innerHTML = `${icon(kind === 'error' ? 'warning' : 'check')}<span></span>`;
  toast.querySelector('span').textContent = message;
  host.appendChild(toast);

  const remove = () => {
    toast.classList.add('leaving');
    setTimeout(() => toast.remove(), 200);
  };
  toast.addEventListener('click', remove);
  setTimeout(remove, timeout);
  return toast;
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

/*
 * A read-only field holding something you are meant to copy selects itself when
 * clicked, and a masked one (a stream key) reveals itself first. These were
 * inline onclick attributes, which this site's own CSP refuses to run — the
 * controls looked normal and did nothing at all.
 */
function setupCopyFields() {
  document.addEventListener('click', (event) => {
    const field = event.target.closest('[data-select-on-click], [data-reveal-on-click]');
    if (!field) return;
    if (field.hasAttribute('data-reveal-on-click')) field.type = 'text';
    field.select();
  });
}

async function bootstrap() {
  await auth.load();
  renderHeader();
  hydrateIcons();
  setupCopyFields();
}
