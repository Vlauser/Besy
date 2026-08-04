/* ==========================================================
   AXIOMANTIC — скрипты админ-панели
   Повторяющиеся блоки, загрузка картинок, боковое меню.
   ========================================================== */
(function () {
  'use strict';

  // Адрес эндпоинта считаем от текущего пути — работает и в подпапке
  var UPLOAD_URL = (function () {
    var p = location.pathname;
    var i = p.indexOf('/admin');
    return (i >= 0 ? p.slice(0, i) : '') + '/admin/upload.php';
  })();

  function token() {
    var el = document.querySelector('input[name="_csrf"]');
    return el ? el.value : '';
  }

  /* ---------- боковое меню на телефоне ---------- */
  var sideToggle = document.getElementById('sideToggle');
  var side = document.getElementById('side');
  if (sideToggle && side) {
    sideToggle.addEventListener('click', function () {
      var nav = side.querySelector('.side-nav');
      if (nav) nav.classList.toggle('on');
    });
  }

  /* ---------- сворачивание строки ---------- */
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-toggle]');
    if (!t || t.id === 'sideToggle') return;
    var row = t.closest('[data-row]');
    if (!row) return;
    var body = row.querySelector('.row-body');
    if (!body) return;
    body.style.display = (body.style.display === 'none') ? '' : 'none';
  });

  /* ---------- повторяющиеся блоки ---------- */

  // Переписываем индексы в именах полей: r[path][N][field]
  function reindex(rep) {
    var path = rep.getAttribute('data-path');
    var rows = rep.querySelectorAll('[data-list] > [data-row]');

    Array.prototype.forEach.call(rows, function (row, i) {
      Array.prototype.forEach.call(row.querySelectorAll('[name]'), function (el) {
        var n = el.getAttribute('name');
        var prefix = 'r[' + path + '][';
        if (n.indexOf(prefix) !== 0) return;
        var rest = n.slice(prefix.length);
        var close = rest.indexOf(']');
        if (close < 0) return;
        el.setAttribute('name', prefix + i + ']' + rest.slice(close + 1));
      });
    });

    var counter = rep.querySelector('.count');
    if (counter) counter.textContent = rows.length;

    var addBtn = rep.querySelector('[data-add]');
    var max = parseInt(rep.getAttribute('data-max') || '0', 10);
    if (addBtn && max > 0) {
      addBtn.disabled = rows.length >= max;
      addBtn.title = rows.length >= max ? 'Больше ' + max + ' нельзя' : '';
    }
  }

  // Добавить
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-add]');
    if (!btn) return;
    var rep = btn.closest('[data-rep]');
    var tpl = rep.querySelector('[data-tpl]');
    var list = rep.querySelector('[data-list]');
    if (!tpl || !list) return;

    var max = parseInt(rep.getAttribute('data-max') || '0', 10);
    var count = list.querySelectorAll(':scope > [data-row]').length;
    if (max > 0 && count >= max) return;

    var html = tpl.innerHTML.split('__i__').join(String(count));
    var wrap = document.createElement('div');
    wrap.innerHTML = html;
    var row = wrap.firstElementChild;
    if (!row) return;

    list.appendChild(row);
    reindex(rep);
    row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    var first = row.querySelector('input[type=text], textarea');
    if (first) first.focus();
  });

  // Удалить
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-del]');
    if (!btn) return;
    var row = btn.closest('[data-row]');
    var rep = btn.closest('[data-rep]');
    if (!row || !rep) return;
    if (!window.confirm('Удалить этот блок? Изменение применится после сохранения.')) return;
    row.remove();
    reindex(rep);
  });

  // Переместить
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-move]');
    if (!btn) return;
    var dir = parseInt(btn.getAttribute('data-move'), 10);
    var row = btn.closest('[data-row]');
    var rep = btn.closest('[data-rep]');
    if (!row || !rep) return;

    if (dir < 0 && row.previousElementSibling) {
      row.parentNode.insertBefore(row, row.previousElementSibling);
    } else if (dir > 0 && row.nextElementSibling) {
      row.parentNode.insertBefore(row.nextElementSibling, row);
    } else {
      return;
    }
    reindex(rep);
    row.scrollIntoView({ block: 'nearest' });
  });

  // Заголовок строки подхватывает первое поле
  document.addEventListener('input', function (e) {
    var row = e.target.closest('[data-row]');
    if (!row) return;
    var first = row.querySelector('input[type=text]');
    if (e.target !== first) return;
    var title = row.querySelector('.row-title');
    if (title) title.textContent = (first.value || 'Новый пункт').slice(0, 70);
  });

  /* ---------- загрузка картинок ---------- */
  document.addEventListener('click', function (e) {
    var pick = e.target.closest('[data-img-pick]');
    if (pick) {
      var fieldP = pick.closest('[data-img]');
      var fileInput = fieldP.querySelector('[data-img-file]');
      if (fileInput) fileInput.click();
      return;
    }

    var clear = e.target.closest('[data-img-clear]');
    if (clear) {
      var fieldC = clear.closest('[data-img]');
      var input = fieldC.querySelector('[data-img-input]');
      var prev = fieldC.parentNode.querySelector('[data-img-prev]');
      if (input) input.value = '';
      if (prev) { prev.hidden = true; prev.innerHTML = ''; }
      clear.remove();
    }
  });

  document.addEventListener('change', function (e) {
    var fileInput = e.target.closest('[data-img-file]');
    if (!fileInput || !fileInput.files || !fileInput.files[0]) return;

    var field = fileInput.closest('[data-img]');
    var input = field.querySelector('[data-img-input]');
    var pickBtn = field.querySelector('[data-img-pick]');
    var prev = field.parentNode.querySelector('[data-img-prev]');
    var file = fileInput.files[0];

    var fd = new FormData();
    fd.append('file', file);
    fd.append('_csrf', token());

    var was = pickBtn ? pickBtn.textContent : '';
    if (pickBtn) { pickBtn.textContent = 'Загружаю…'; pickBtn.disabled = true; }

    fetch(UPLOAD_URL, { method: 'POST', body: fd, credentials: 'same-origin' })
      .then(function (r) { return r.json().catch(function () { return { ok: false, error: 'Сервер вернул не JSON (код ' + r.status + ')' }; }); })
      .then(function (data) {
        if (!data.ok) throw new Error(data.error || 'Не удалось загрузить');
        if (input) input.value = data.url;
        if (prev) {
          prev.hidden = false;
          prev.innerHTML = '<img src="' + data.url + '" alt="">';
        }
        if (!field.querySelector('[data-img-clear]')) {
          var b = document.createElement('button');
          b.type = 'button';
          b.className = 'mini mini--danger';
          b.setAttribute('data-img-clear', '');
          b.textContent = 'Убрать';
          field.insertBefore(b, fileInput);
        }
      })
      .catch(function (err) { window.alert('Загрузка не удалась: ' + err.message); })
      .finally(function () {
        if (pickBtn) { pickBtn.textContent = was || 'Загрузить'; pickBtn.disabled = false; }
        fileInput.value = '';
      });
  });


  /* ---------- выбор цвета ---------- */
  document.addEventListener('input', function (e) {
    var field = e.target.closest('[data-color]');
    if (!field) return;
    var pick = field.querySelector('[data-color-pick]');
    var text = field.querySelector('[data-color-text]');
    if (!pick || !text) return;

    if (e.target === pick) {
      text.value = pick.value.toUpperCase();
    } else if (e.target === text) {
      var v = text.value.trim();
      if (/^#[0-9a-f]{6}$/i.test(v)) pick.value = v;
    }
  });

  /* ---------- подтверждение опасных действий ---------- */
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-confirm]');
    if (!el) return;
    if (!window.confirm(el.getAttribute('data-confirm') || 'Подтвердите действие')) {
      e.preventDefault();
      e.stopPropagation();
    }
  });

  /* ---------- предупреждение о несохранённых правках ---------- */
  var form = document.querySelector('form[data-dirty], .main form');
  if (form) {
    var dirty = false;
    form.addEventListener('input', function () { dirty = true; });
    form.addEventListener('submit', function () { dirty = false; });
    window.addEventListener('beforeunload', function (ev) {
      if (!dirty) return;
      ev.preventDefault();
      ev.returnValue = '';
    });
  }

  // пригодится второму блоку скрипта — при создании копии блока
  window.__axmReindex = reindex;

  /* Начальная нумерация */
  Array.prototype.forEach.call(document.querySelectorAll('[data-rep]'), reindex);
})();

/* ==========================================================
   Дополнения: копия блока и счётчик символов в SEO-полях
   ========================================================== */
(function () {
  'use strict';

  /* ---------- копия блока ---------- */
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-dup]');
    if (!btn) return;

    var row = btn.closest('[data-row]');
    var rep = btn.closest('[data-rep]');
    if (!row || !rep) return;

    var max = parseInt(rep.getAttribute('data-max') || '0', 10);
    var list = rep.querySelector('[data-list]');
    var count = list.querySelectorAll(':scope > [data-row]').length;
    if (max > 0 && count >= max) {
      window.alert('Больше ' + max + ' блоков в этом разделе нельзя.');
      return;
    }

    var copy = row.cloneNode(true);

    // переносим значения: клонирование не копирует то, что человек напечатал
    var from = row.querySelectorAll('input, textarea, select');
    var to = copy.querySelectorAll('input, textarea, select');
    for (var i = 0; i < from.length; i++) {
      if (from[i].type === 'checkbox' || from[i].type === 'radio') to[i].checked = from[i].checked;
      else to[i].value = from[i].value;
    }

    var title = copy.querySelector('.row-title');
    if (title) title.textContent = (title.textContent || 'Копия') + ' — копия';

    row.parentNode.insertBefore(copy, row.nextSibling);

    if (window.__axmReindex) window.__axmReindex(rep);

    copy.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });

  /* ---------- счётчик символов ---------- */
  var LIMITS = [
    { match: /_title\]/, max: 60,  label: 'заголовок в выдаче' },
    { match: /_desc\]/,  max: 160, label: 'описание в выдаче' }
  ];

  function attach(el, limit) {
    var box = document.createElement('div');
    box.className = 'char-count';
    el.parentNode.appendChild(box);

    function upd() {
      var n = el.value.length;
      box.textContent = n + ' из ' + limit.max + ' — ' + limit.label;
      box.classList.toggle('over', n > limit.max);
      box.classList.toggle('near', n > limit.max * 0.85 && n <= limit.max);
    }
    el.addEventListener('input', upd);
    upd();
  }

  document.querySelectorAll('input[name], textarea[name]').forEach(function (el) {
    var name = el.getAttribute('name') || '';
    for (var i = 0; i < LIMITS.length; i++) {
      if (LIMITS[i].match.test(name)) { attach(el, LIMITS[i]); break; }
    }
  });
})();
