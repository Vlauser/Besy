/**
 * Отправка сбоев браузера на сервер.
 *
 * Без этого каждый сбой оставлял после себя только скриншот пустого
 * экрана. Теперь в журнале сервиса появляется строка с текстом ошибки и
 * именем сборки — этого хватает, чтобы понять, что именно упало.
 *
 * Ручка на сервере открытая, поэтому здесь мы сдерживаем себя сами:
 * одинаковое сообщение уходит один раз, и не больше пяти за сеанс. Одна
 * поломка в цикле отрисовки способна выстрелить сотней одинаковых
 * ошибок, и без этого мы завалили бы и журнал, и связь.
 */

const MAX_PER_SESSION = 5;
const sent = new Set();
let count = 0;

/** Имя собранного файла — чтобы в журнале было видно, какая это версия. */
function bundleName() {
  const script = document.querySelector('script[src*="/assets/index-"]');
  return script ? script.getAttribute("src").split("/").pop() : null;
}

export function reportClientError(message, { source, stack } = {}) {
  if (!message) return;
  const key = `${message}|${source || ""}`;
  if (sent.has(key) || count >= MAX_PER_SESSION) return;
  sent.add(key);
  count += 1;

  const base = import.meta.env.VITE_API_URL || "/api";
  const body = JSON.stringify({
    message: String(message).slice(0, 500),
    source: source ? String(source).slice(0, 200) : null,
    stack: stack ? String(stack).slice(0, 4000) : null,
    bundle: bundleName(),
    path: location.pathname + location.search,
  });

  // keepalive: отчёт должен уйти, даже если страницу закрывают прямо
  // сейчас — а закрывают её как раз тогда, когда всё сломалось.
  fetch(`${base}/client-errors`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => {
    // Сообщить о том, что не удалось сообщить об ошибке, всё равно некуда.
  });
}

export function installErrorReporting() {
  window.addEventListener("error", (event) => {
    reportClientError(event.message, {
      source: `${event.filename || "?"}:${event.lineno || 0}`,
      stack: event.error?.stack,
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    reportClientError(reason?.message || String(reason), {
      source: "промис без обработчика",
      stack: reason?.stack,
    });
  });
}
