(async function main() {
  await bootstrap();

  if (!auth.user) return auth.requireLogin('/settings');

  const content = document.getElementById('content');

  function section(title, body, id = '') {
    return `<div class="panel mt-16"${id ? ` id="${id}"` : ''}><h2>${title}</h2>${body}</div>`;
  }

  async function render() {
    const [{ user }, sessionsData, strikesData, blocksData] = await Promise.all([
      api.get('/api/auth/me'),
      api.get('/api/auth/sessions'),
      api.get(`/api/moderation/users/${auth.user.username}/strikes`).catch(() => ({ active: 0, strikes: [], limit: 3 })),
      api.get('/api/me/blocks').catch(() => ({ blocks: [] })),
    ]);
    auth.user = user;

    const emailBlock = user.emailVerified
      ? '<div class="alert alert-ok">E-mail подтверждён</div>'
      : `<div class="alert alert-error">E-mail не подтверждён — загрузка видео и комментарии недоступны</div>
         <button class="btn" id="resend-btn">Отправить письмо ещё раз</button>`;

    const twoFactorBlock = user.twoFactor
      ? `<div class="alert alert-ok">Двухфакторная защита включена</div>
         <form id="twofa-disable">
           <div class="field">
             <label for="disable-pass">Пароль для отключения</label>
             <input class="input" id="disable-pass" name="password" type="password" required autocomplete="current-password">
           </div>
           <button class="btn btn-danger" type="submit">Отключить 2FA</button>
         </form>`
      : `<p class="hint">Одноразовые коды из приложения (Google Authenticator, Aegis, 1Password) защитят аккаунт, даже если пароль утечёт.</p>
         <button class="btn btn-primary" id="twofa-start">Включить двухфакторную защиту</button>
         <div id="twofa-setup" class="mt-16" hidden></div>`;

    const sessions = sessionsData.sessions.map((session) => `
      <div class="row" style="justify-content:space-between;padding:9px 0;border-bottom:1px solid var(--border)">
        <div>
          <div>${escapeHtml(session.userAgent || 'Неизвестное устройство').slice(0, 70)}</div>
          <div class="card-meta">${escapeHtml(session.ip || '—')} · активна ${fmt.ago(session.lastSeenAt || session.createdAt)}</div>
        </div>
        ${session.current
          ? '<span class="tag">текущая</span>'
          : `<button class="btn btn-danger" data-session="${session.id}">Завершить</button>`}
      </div>`).join('');

    const strikes = strikesData.strikes.length
      ? strikesData.strikes.map((strike) => `
        <div style="padding:9px 0;border-bottom:1px solid var(--border)">
          <div><strong>${escapeHtml(strike.reason)}</strong> ${strike.expired ? '<span class="tag">истекло</span>' : ''}</div>
          <div class="card-meta">
            ${strike.videoTitle ? `${escapeHtml(strike.videoTitle)} · ` : ''}${fmt.ago(strike.createdAt)}
            ${strike.expired ? '' : `· снимется ${new Date(strike.expiresAt).toLocaleDateString('ru-RU')}`}
          </div>
        </div>`).join('')
      : '<div class="hint">Предупреждений нет — так держать.</div>';

    const blockList = blocksData.blocks.length
      ? `<div class="block-list">${blocksData.blocks.map((entry) => `
          <div class="block-row">
            <a href="/@${escapeHtml(entry.username)}">${escapeHtml(entry.username)}</a>
            <button class="btn btn-ghost" data-unblock="${escapeHtml(entry.username)}">Разблокировать</button>
          </div>`).join('')}</div>
         <p class="hint mt-16">Заблокированные не могут комментировать ваши видео,
           писать в чат ваших эфиров и подписываться на канал. Они об этом не узнают.</p>`
      : '<div class="hint">Вы никого не блокировали. Заблокировать можно со страницы канала.</div>';

    /*
     * Appearance sits first because it is the only thing here that changes
     * while you look at it. Both controls are the phone's: which theme, and
     * how transparent the glass is — iOS 27 put that on a slider, and three
     * stops are enough on a screen this size. Turning on Reduce Transparency
     * in the operating system overrules the middle one entirely, which is
     * also how the phone behaves.
     */
    const appearanceBlock = `
      <label class="field-label" id="theme-label">Тема</label>
      <div class="choice-row" role="group" aria-labelledby="theme-label" id="theme-row">
        ${[['system', 'Как в системе'], ['light', 'Светлая'], ['dark', 'Тёмная']].map(([value, label]) =>
          `<button type="button" data-theme-choice="${value}">${label}</button>`).join('')}
      </div>
      <label class="field-label mt-16" id="glass-label">Прозрачность</label>
      <div class="choice-row" role="group" aria-labelledby="glass-label" id="glass-row">
        ${[['clear', 'Прозрачно'], ['regular', 'Обычно'], ['solid', 'Плотно']].map(([value, label]) =>
          `<button type="button" data-glass-choice="${value}">${label}</button>`).join('')}
      </div>
      <p class="hint mt-16">Настройки живут в этом браузере и применяются сразу.</p>`;

    content.innerHTML = `
      ${section('Внешний вид', appearanceBlock)}
      ${section('E-mail', emailBlock)}
      ${section('Пароль', `
        <form id="password-form">
          <div class="field">
            <label for="current">Текущий пароль</label>
            <input class="input" id="current" name="currentPassword" type="password" required autocomplete="current-password">
          </div>
          <div class="field">
            <label for="new-pass">Новый пароль</label>
            <input class="input" id="new-pass" name="newPassword" type="password" minlength="8" required autocomplete="new-password">
          </div>
          <button class="btn" type="submit">Сменить пароль</button>
          <div class="hint mt-16">Остальные устройства будут разлогинены.</div>
        </form>`)}
      ${section('Логин и адрес канала', `
        <p class="hint">Логин — это и адрес вашего канала: <code>/@${escapeHtml(user.username)}</code>.</p>
        <p class="hint mt-8"><strong>После смены старый адрес перестанет работать</strong> и сразу
          освободится — его сможет занять кто угодно, включая того, кто захочет,
          чтобы его приняли за вас. Ссылки на ваш канал в чужих постах, закладках
          и описаниях видео перестанут вести куда нужно.</p>
        <p class="hint mt-8">Менять можно раз в 14 дней.</p>
        <form id="handle-form" class="mt-16">
          <div class="field">
            <label for="handle">Новый логин</label>
            <input class="input" id="handle" name="username" value="${escapeHtml(user.username)}"
                   pattern="[a-zA-Z0-9_]{3,24}" minlength="3" maxlength="24" required>
            <div class="hint mt-8">3–24 символа: латиница, цифры и «_»</div>
          </div>
          <button class="btn" type="submit">Сменить логин</button>
        </form>`)}
      ${section('Двухфакторная защита', twoFactorBlock)}
      ${section('Активные сессии', `${sessions}
        <button class="btn mt-16" id="revoke-others">Завершить все другие сессии</button>`)}
      ${section(`Предупреждения (${strikesData.active} из ${strikesData.limit})`, strikes)}
      ${section('Заблокированные', blockList)}
      ${section('Ваши данные', `
        <p class="hint">Выгрузка содержит видео, комментарии, подписки, историю и сессии —
          всё, что сервис о вас хранит. Пароль, ключи двухфакторной защиты и токены
          сессий в неё не входят: это доступы, а не данные о вас.</p>
        <a class="btn mt-16" href="/api/me/export" download>Скачать мои данные</a>`)}
      ${section('Удаление аккаунта', `
        <p class="hint">Удаляются канал, видео, комментарии, плейлисты и подписки.
          Отменить нельзя, и имя канала освободится.</p>
        <form id="delete-form" class="mt-16">
          <div class="field">
            <label for="del-pass">Подтвердите паролем</label>
            <input class="input" id="del-pass" name="password" type="password" required
                   autocomplete="current-password">
          </div>
          <button class="btn btn-danger" type="submit">Удалить аккаунт навсегда</button>
        </form>`)}`;

    wire();
  }

  /** Marks the current choice and applies a new one the moment it is pressed. */
  function wireAppearance() {
    const rows = [
      ['theme-row', 'themeChoice', appearance.theme, 'system'],
      ['glass-row', 'glassChoice', appearance.glass, 'regular'],
    ];
    for (const [id, attribute, apply, fallback] of rows) {
      const row = document.getElementById(id);
      if (!row) continue;
      const mark = (current) => row.querySelectorAll('button').forEach((button) => {
        const mine = button.dataset[attribute] === current;
        button.classList.toggle('active', mine);
        button.setAttribute('aria-pressed', String(mine));
      });
      mark(apply());
      row.addEventListener('click', (event) => {
        const button = event.target.closest('button');
        if (!button) return;
        mark(apply(button.dataset[attribute] || fallback));
      });
    }
  }

  function wire() {
    wireAppearance();

    document.getElementById('resend-btn')?.addEventListener('click', async (event) => {
      event.target.disabled = true;
      try {
        await api.post('/api/auth/verify/resend');
        event.target.textContent = 'Письмо отправлено';
      } catch (err) {
        notify(err.message, 'error');
        event.target.disabled = false;
      }
    });

    document.getElementById('password-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.target;
      try {
        await api.post('/api/auth/password/change', {
          currentPassword: form.currentPassword.value,
          newPassword: form.newPassword.value,
        });
        form.reset();
        notify('Пароль изменён');
        render();
      } catch (err) {
        notify(err.message, 'error');
      }
    });

    document.getElementById('twofa-start')?.addEventListener('click', async (event) => {
      event.target.disabled = true;
      const box = document.getElementById('twofa-setup');
      try {
        const { secret, qr } = await api.post('/api/auth/2fa/setup');
        box.hidden = false;
        box.innerHTML = `
          <p>Отсканируйте код в приложении или введите ключ вручную:</p>
          <img src="${qr}" alt="QR-код для двухфакторной защиты" width="220" height="220"
               style="border-radius:10px;background:#fff;padding:6px">
          <div class="field mt-16">
            <label>Ключ</label>
            <input class="input" value="${escapeHtml(secret)}" readonly data-select-on-click>
          </div>
          <form id="twofa-enable">
            <div class="field">
              <label for="code">Код из приложения</label>
              <input class="input" id="code" name="code" inputmode="numeric" pattern="[0-9]{6}" required
                     autocomplete="one-time-code" placeholder="123456">
            </div>
            <button class="btn btn-primary" type="submit">Подтвердить и включить</button>
          </form>`;

        document.getElementById('twofa-enable').addEventListener('submit', async (submitEvent) => {
          submitEvent.preventDefault();
          try {
            const { backupCodes } = await api.post('/api/auth/2fa/enable', {
              code: submitEvent.target.code.value,
            });
            box.innerHTML = `
              <div class="alert alert-ok">Готово! Сохраните резервные коды — каждый работает один раз.</div>
              <pre class="panel" style="font-size:15px;line-height:1.9">${backupCodes.join('\n')}</pre>
              <button class="btn" id="twofa-done">Я сохранил коды</button>`;
            document.getElementById('twofa-done').addEventListener('click', render);
          } catch (err) {
            notify(err.message, 'error');
          }
        });
      } catch (err) {
        notify(err.message, 'error');
        event.target.disabled = false;
      }
    });

    document.getElementById('twofa-disable')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        await api.post('/api/auth/2fa/disable', { password: event.target.password.value });
        render();
      } catch (err) {
        notify(err.message, 'error');
      }
    });

    document.getElementById('handle-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const username = document.getElementById('handle').value.trim();
      const button = event.target.querySelector('button');
      button.disabled = true;
      try {
        const ok = await confirmAction(
          `Адрес /@${document.getElementById('handle').defaultValue} перестанет работать и освободится. `
          + 'Ссылки на ваш канал, которыми вы делились, перестанут вести куда нужно.',
          { title: `Сменить логин на @${username}?`, confirmLabel: 'Сменить', danger: true },
        );
        if (!ok) { button.disabled = false; return; }

        const { previous } = await api.post('/api/auth/me/username', { username });
        notify(`Логин сменён. Адрес /@${previous} больше не ваш.`);
        render();
      } catch (err) {
        notify(err.message, 'error');
      } finally {
        button.disabled = false;
      }
    });

    document.getElementById('revoke-others')?.addEventListener('click', async () => {
      await api.post('/api/auth/sessions/revoke-others');
      render();
    });

    content.querySelectorAll('[data-session]').forEach((button) => {
      button.addEventListener('click', async () => {
        await api.del(`/api/auth/sessions/${button.dataset.session}`);
        render();
      });
    });

    content.querySelectorAll('[data-unblock]').forEach((button) => {
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          await api.del(`/api/me/blocks/${encodeURIComponent(button.dataset.unblock)}`);
          render();
        } catch (err) {
          button.disabled = false;
          notify(err.message, 'error');
        }
      });
    });

    document.getElementById('delete-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const password = document.getElementById('del-pass').value;
      if (!await confirmAction(
        'Удалятся канал, все видео, комментарии, плейлисты и подписки. '
        + 'Отменить нельзя, имя канала освободится.',
        { title: 'Удалить аккаунт навсегда?', confirmLabel: 'Удалить аккаунт', danger: true },
      )) return;

      const button = event.target.querySelector('button');
      button.disabled = true;
      try {
        await api.del('/api/me/account', { password });
        location.href = '/';
      } catch (err) {
        button.disabled = false;
        notify(err.message, 'error');
      }
    });
  }

  render();
})();
