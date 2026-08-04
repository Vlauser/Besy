/* ==========================================================
   AXIOMANTIC — скрипты сайта
   Обычный JS без библиотек: меню, аккордеон, фильтр проектов,
   отправка заявки, согласие на cookie.
   ========================================================== */
(function () {
  'use strict';

  var CFG = window.AXM || {};

  /* ---------- появление блоков при прокрутке ---------- */
  var reveals = document.querySelectorAll('.reveal');
  if (reveals.length) {
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) {
            en.target.classList.add('is-visible');
            io.unobserve(en.target);
          }
        });
      }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
      reveals.forEach(function (el) { io.observe(el); });
    } else {
      reveals.forEach(function (el) { el.classList.add('is-visible'); });
    }
  }

  /* ---------- меню на телефоне ---------- */
  var burger = document.getElementById('menuButton');
  var nav = document.getElementById('mainNav');
  if (burger && nav) {
    burger.addEventListener('click', function () {
      var open = nav.classList.toggle('open');
      burger.setAttribute('aria-expanded', open ? 'true' : 'false');
      burger.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
      var o = burger.querySelector('[data-menu-open]');
      var c = burger.querySelector('[data-menu-close]');
      if (o) o.hidden = open;
      if (c) c.hidden = !open;
      document.body.style.overflow = open ? 'hidden' : '';
    });
    nav.addEventListener('click', function (e) {
      if (e.target.closest('a')) {
        nav.classList.remove('open');
        burger.setAttribute('aria-expanded', 'false');
        var o = burger.querySelector('[data-menu-open]');
        var c = burger.querySelector('[data-menu-close]');
        if (o) o.hidden = false;
        if (c) c.hidden = true;
        document.body.style.overflow = '';
      }
    });
  }

  /* ---------- вопросы и ответы ---------- */
  var faq = document.getElementById('faq');
  if (faq) {
    faq.addEventListener('click', function (e) {
      var btn = e.target.closest('button');
      if (!btn) return;
      var item = btn.parentElement;
      var wasOpen = item.classList.contains('open');
      faq.querySelectorAll('.faq-item').forEach(function (x) {
        x.classList.remove('open');
        var b = x.querySelector('button');
        if (b) b.setAttribute('aria-expanded', 'false');
      });
      if (!wasOpen) {
        item.classList.add('open');
        btn.setAttribute('aria-expanded', 'true');
      }
    });
  }

  /* ---------- фильтр проектов ---------- */
  var filters = document.getElementById('filters');
  var grid = document.getElementById('projectGrid');
  if (filters && grid) {
    var empty = document.getElementById('projectsEmpty');
    filters.addEventListener('click', function (e) {
      var b = e.target.closest('.filter-button');
      if (!b) return;
      filters.querySelectorAll('.filter-button').forEach(function (x) {
        x.classList.remove('active');
        x.setAttribute('aria-pressed', 'false');
      });
      b.classList.add('active');
      b.setAttribute('aria-pressed', 'true');

      var f = b.getAttribute('data-f');
      var shown = 0;
      grid.querySelectorAll('.project-slot').forEach(function (slot) {
        // «Лендинги» показываем целиком: все проекты сделаны как лендинги
        var ok = f === 'all' || f === 'landing' || slot.getAttribute('data-c') === f;
        slot.hidden = !ok;
        if (ok) shown++;
      });
      if (empty) empty.hidden = shown > 0;
    });
  }

  /* ---------- способ связи: позвонить или написать ---------- */
  document.querySelectorAll('[data-form]').forEach(function (form) {
    var modeBtns = form.querySelectorAll('[data-mode-btn]');
    if (!modeBtns.length) return;

    function setMode(mode) {
      form.setAttribute('data-mode', mode);
      modeBtns.forEach(function (b) {
        var on = b.getAttribute('data-mode-btn') === mode;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      form.querySelectorAll('[data-pane]').forEach(function (p) {
        p.hidden = p.getAttribute('data-pane') !== mode;
      });
      hideErrors(form);
      var inp = activeInput(form);
      if (inp) inp.focus();
    }

    modeBtns.forEach(function (b) {
      b.addEventListener('click', function () { setMode(b.getAttribute('data-mode-btn')); });
    });

    // выбор мессенджера меняет подсказку в поле
    form.querySelectorAll('[data-messenger]').forEach(function (b) {
      b.addEventListener('click', function () {
        form.querySelectorAll('[data-messenger]').forEach(function (x) {
          var on = x === b;
          x.classList.toggle('is-active', on);
          x.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        var inp = form.querySelector('[data-pane="write"] [data-contact]');
        if (inp) {
          inp.placeholder = b.getAttribute('data-placeholder') || '';
          inp.focus();
        }
      });
    });
  });

  // поле контакта из активной вкладки
  function activeInput(form) {
    var pane = form.querySelector('[data-pane]:not([hidden])');
    return pane ? pane.querySelector('[data-contact]') : null;
  }

  function hideErrors(form) {
    form.querySelectorAll('.field-error').forEach(function (e) { e.hidden = true; });
    form.querySelectorAll('[data-contact]').forEach(function (i) { i.classList.remove('invalid'); });
  }

  /* ---------- отправка заявки ---------- */
  document.querySelectorAll('[data-form]').forEach(function (form) {
    var btn = form.querySelector('[data-submit]');
    if (!btn) return;

    var failBox = form.querySelector('.form-fail');

    function val(sel) {
      var el = form.querySelector(sel);
      return el ? el.value.trim() : '';
    }

    function showError(el, msg) {
      if (!el) return;
      el.classList.add('invalid');
      var box = el.parentElement.querySelector('.field-error');
      if (box) {
        if (msg) box.textContent = msg;
        box.hidden = false;
      }
    }

    btn.addEventListener('click', function () {
      hideErrors(form);
      if (failBox) failBox.hidden = true;

      var mode = form.getAttribute('data-mode') || 'call';
      var input = activeInput(form);
      var contact = input ? input.value.trim() : '';
      var valid = true;

      if (!contact) {
        showError(input);
        valid = false;
      } else if (mode === 'call') {
        if (contact.replace(/\D/g, '').length < 10) {
          showError(input, 'Похоже на ошибку — проверьте номер');
          valid = false;
        }
      } else {
        var ok = /^@?[a-zA-Z0-9_.]{3,}$/.test(contact) || contact.replace(/\D/g, '').length >= 10;
        if (!ok) {
          showError(input, 'Укажите @ник или номер');
          valid = false;
        }
      }

      var check = form.querySelector('[data-req-check]');
      var checkErr = form.querySelector('.consent-error');
      if (check && !check.checked) {
        if (checkErr) checkErr.hidden = false;
        valid = false;
      }

      if (!valid) { if (input) input.focus(); return; }

      var mBtn = form.querySelector('[data-messenger].is-active');
      var agreeEl = form.querySelector('.consent-row span');

      var payload = {
        form: CFG.page || 'site',
        page: location.pathname,
        name: val('[name=name]'),
        contact: contact,
        contact_mode: mode,
        messenger: mode === 'write' && mBtn ? mBtn.getAttribute('data-messenger') : '',
        message: val('[name=message]'),
        website: val('[name=website]'),
        agree: 1,
        agree_text: agreeEl ? agreeEl.textContent.trim() : '',
        marketing: (form.querySelector('[name=marketing]') || {}).checked ? 1 : 0
      };

      btn.disabled = true;
      var label = btn.textContent;
      btn.textContent = 'Отправляем…';

      fetch(CFG.api, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
        .then(function (r) {
          return r.json().catch(function () {
            return { ok: false, error: 'Сервер вернул неожиданный ответ' };
          });
        })
        .then(function (data) {
          if (!data.ok) throw new Error(data.error || 'Не удалось отправить заявку');

          form.querySelectorAll('input, textarea').forEach(function (i) {
            if (i.type === 'checkbox') i.checked = false; else i.value = '';
          });

          // сначала закрываем окно заявки, потом показываем окно успеха
          var backdrop = form.closest('.ax-backdrop');
          if (backdrop && window.__axCloseModal) window.__axCloseModal();

          document.dispatchEvent(new CustomEvent('axiomantic:form-success'));
          if (window.ym && window.AXM_METRIKA) window.ym(window.AXM_METRIKA, 'reachGoal', 'lead');
        })
        .catch(function (err) {
          if (failBox) { failBox.textContent = err.message; failBox.hidden = false; }
        })
        .finally(function () {
          btn.disabled = false;
          btn.textContent = label;
        });
    });

    form.addEventListener('input', function (e) {
      if (e.target.matches('[data-contact]') && e.target.value.trim()) {
        e.target.classList.remove('invalid');
        var box = e.target.parentElement.querySelector('.field-error');
        if (box) box.hidden = true;
      }
      if (e.target.matches('[data-req-check]') && e.target.checked) {
        var ce = form.querySelector('.consent-error');
        if (ce) ce.hidden = true;
      }
    });
  });

  /* ---------- модальное окно заявки ---------- */
  (function () {
    var modal = document.getElementById('ax-modal');
    if (!modal) return;

    var dialog = modal.querySelector('.ax-modal');
    var lastFocus = null;

    function open() {
      lastFocus = document.activeElement;
      modal.hidden = false;
      document.body.classList.add('ax-modal-open');
      var first = modal.querySelector('[data-mode-btn], input, button');
      if (first) setTimeout(function () { first.focus(); }, 30);
    }

    function close() {
      modal.hidden = true;
      document.body.classList.remove('ax-modal-open');
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }

    window.__axCloseModal = close;

    document.addEventListener('click', function (e) {
      if (e.target.closest('[data-ax-open]')) { e.preventDefault(); open(); }
      if (e.target.closest('[data-ax-close]')) close();
    });
    modal.addEventListener('mousedown', function (e) {
      if (dialog && !dialog.contains(e.target)) close();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !modal.hidden) close();
    });
  })();

  /* ---------- cookie и отложенный запуск Метрики ---------- */
  (function () {
    var KEY = 'axm_cookie_consent';
    var box = document.getElementById('cookie');

    function read() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
    function save(v) {
      try { localStorage.setItem(KEY, v); } catch (e) {}
      var d = new Date();
      d.setFullYear(d.getFullYear() + 1);
      document.cookie = KEY + '=' + v + ';path=/;expires=' + d.toUTCString() + ';samesite=lax';
    }

    function startMetrika() {
      var id = window.AXM_METRIKA;
      if (!id || window.__axmMetrikaOn) return;
      window.__axmMetrikaOn = true;
      (function (m, e, t, r, i, k, a) {
        m[i] = m[i] || function () { (m[i].a = m[i].a || []).push(arguments); };
        m[i].l = 1 * new Date();
        for (var j = 0; j < e.scripts.length; j++) { if (e.scripts[j].src === r) return; }
        k = e.createElement(t); a = e.getElementsByTagName(t)[0];
        k.async = 1; k.src = r; a.parentNode.insertBefore(k, a);
      })(window, document, 'script', 'https://mc.yandex.ru/metrika/tag.js', 'ym');
      window.ym(id, 'init', { clickmap: true, trackLinks: true, accurateTrackBounce: true });
    }

    var choice = read();
    if (choice === 'yes') {
      startMetrika();
    } else if (choice !== 'no' && box) {
      box.hidden = false;
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { box.classList.add('show'); });
      });
    }

    if (box) {
      box.addEventListener('click', function (e) {
        var b = e.target.closest('[data-cookie]');
        if (!b) return;
        var v = b.getAttribute('data-cookie');
        save(v);
        if (v === 'yes') startMetrika();
        box.classList.remove('show');
        setTimeout(function () { box.hidden = true; }, 300);
      });
    }
  })();
})();


/* ==========================================================
   Окно об успешной отправке
   ========================================================== */
(function () {
  'use strict';
  var modal = document.getElementById('application-success-modal');
  if (!modal) return;

  var dialog = modal.querySelector('.ax-success-dialog');
  var lastFocus = null;

  function open() {
    lastFocus = document.activeElement;
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('ax-modal-open');
    var ok = modal.querySelector('.ax-success-ok');
    if (ok) setTimeout(function () { ok.focus(); }, 30);
  }

  function close() {
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('ax-modal-open');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  modal.querySelectorAll('.ax-success-close, .ax-success-ok').forEach(function (b) {
    b.addEventListener('click', close);
  });
  modal.addEventListener('mousedown', function (e) {
    if (dialog && !dialog.contains(e.target)) close();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && modal.classList.contains('is-open')) close();
  });

  // окно открывается только после подтверждённого ответа сервера
  document.addEventListener('axiomantic:form-success', open);
})();
