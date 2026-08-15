/**
 * Thin wrapper over window.Telegram.WebApp.
 *
 * Everything degrades to a no-op in a plain browser so the app stays
 * runnable with `npm run dev` outside Telegram.
 */

/**
 * SDK берём заново при каждом обращении, а не один раз при загрузке
 * модуля: telegram-web-app.js может выполниться позже нашего бандла, и
 * тогда захваченное значение навсегда осталось бы undefined.
 */
function webApp() {
  return typeof window !== "undefined" ? window.Telegram?.WebApp : undefined;
}

/** SDK загрузился — значит страницу открыл Telegram, а не обычный браузер. */
export function hasTelegramSdk() {
  return Boolean(webApp());
}

/** Полноценный запуск Mini App: SDK есть и есть подписанный initData. */
export function isTelegram() {
  return Boolean(webApp()?.initData);
}

/** Дождаться SDK, но не дольше отведённого срока.
 *
 *  Скрипт Telegram грузится с чужого домена и был блокирующим: пока он не
 *  пришёл, браузер не шёл дальше по странице, и приложение не начинало
 *  грузиться вовсе. Там, где `telegram.org` недоступен, это давало белый
 *  экран без единого признака жизни — ни ошибки, ни подсказки.
 *
 *  Теперь скрипт асинхронный, а ждём его мы сами и ограниченное время. Не
 *  дождались — запускаемся всё равно и говорим, что именно не загрузилось.
 */
export function waitForSdk(timeoutMs = 3000) {
  if (hasTelegramSdk()) return Promise.resolve(true);
  if (typeof window === "undefined") return Promise.resolve(false);

  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    // Опрос, а не onload: так работает независимо от того, каким путём
    // скрипт добрался до страницы и добрался ли вообще.
    const tick = () => {
      if (hasTelegramSdk()) resolve(true);
      else if (Date.now() >= deadline) resolve(false);
      else setTimeout(tick, 50);
    };
    tick();
  });
}

export function initTelegram() {
  const app = webApp();
  if (!app) return;
  app.ready();
  app.expand();
  // Swipe-to-dismiss fights the swipe deck for the same gesture.
  app.disableVerticalSwipes?.();
  app.setHeaderColor?.("#FFFFFF");
  app.setBackgroundColor?.("#F3F6FD");
}

export function getInitData() {
  return webApp()?.initData || "";
}

/** Ниже этого высота — не экран, а промежуточное состояние анимации. */
const MIN_SENSIBLE_HEIGHT = 320;

export function getViewportHeight() {
  const own = typeof window !== "undefined" ? window.innerHeight : 720;
  const reported = webApp()?.viewportStableHeight || 0;

  // Пока веб-вью разворачивается, Telegram отдаёт переходную высоту — при
  // повторном открытии это бывают десятки пикселей. Раньше мы записывали её
  // как есть, и она залипала: приложение схлопывалось в полоску, таб-бар
  // оказывался под самой шапкой, а под ним пустота. Событий, которые это
  // исправили бы, дальше не приходило.
  if (reported >= MIN_SENSIBLE_HEIGHT) return reported;
  if (own >= MIN_SENSIBLE_HEIGHT) return own;
  return Math.max(reported, own, MIN_SENSIBLE_HEIGHT);
}

export function onViewportChange(handler) {
  const app = webApp();
  const cleanups = [];

  if (app?.onEvent) {
    app.onEvent("viewportChanged", handler);
    cleanups.push(() => app.offEvent("viewportChanged", handler));
  }
  if (typeof window === "undefined") return () => {};

  // Своих событий Telegram при повторном открытии может не прислать вовсе:
  // веб-вью не перезагружается, и мини-апп остаётся с той высотой, что была
  // в момент сворачивания. Поэтому слушаем ещё и браузерные сигналы.
  const revive = () => {
    // Вернувшись, разворачиваемся заново: Telegram способен восстановить
    // окно свёрнутым, и одной пересчитанной высоты тогда мало.
    if (!document.hidden) app?.expand?.();
    handler();
  };
  window.addEventListener("resize", revive);
  window.addEventListener("focus", revive);
  document.addEventListener("visibilitychange", revive);
  cleanups.push(() => {
    window.removeEventListener("resize", revive);
    window.removeEventListener("focus", revive);
    document.removeEventListener("visibilitychange", revive);
  });

  return () => cleanups.forEach((stop) => stop());
}

/** Сколько сверху и снизу занято чужим — вырезом экрана и шапкой Telegram.
 *
 *  В развёрнутом виде Telegram рисует свою шапку («Закрыть», «⋯») поверх
 *  веб-вью, а не над ним. Без отступа наш заголовок оказывается под ней, а
 *  выше — наезжает на системные часы. Высота вьюпорта об этом не говорит
 *  ничего: она считает всю область, включая занятую.
 *
 *  Оба поля появились в Bot API 8.0. На клиентах постарше их нет, отступы
 *  выходят нулевыми — то есть ровно прежнее поведение.
 */
export function getSafeAreaInsets() {
  const app = webApp();
  const device = app?.safeAreaInset || {};
  const content = app?.contentSafeAreaInset || {};
  return {
    top: (device.top || 0) + (content.top || 0),
    bottom: (device.bottom || 0) + (content.bottom || 0),
  };
}

export function onSafeAreaChange(handler) {
  const app = webApp();
  if (!app?.onEvent) return () => {};
  // Меняются независимо: поворот экрана трогает первый, сворачивание —
  // второй.
  app.onEvent("safeAreaChanged", handler);
  app.onEvent("contentSafeAreaChanged", handler);
  return () => {
    app.offEvent("safeAreaChanged", handler);
    app.offEvent("contentSafeAreaChanged", handler);
  };
}

/* ---------------- haptics ---------------- */

export const haptic = {
  light: () => webApp()?.HapticFeedback?.impactOccurred?.("light"),
  medium: () => webApp()?.HapticFeedback?.impactOccurred?.("medium"),
  heavy: () => webApp()?.HapticFeedback?.impactOccurred?.("heavy"),
  success: () => webApp()?.HapticFeedback?.notificationOccurred?.("success"),
  warning: () => webApp()?.HapticFeedback?.notificationOccurred?.("warning"),
  error: () => webApp()?.HapticFeedback?.notificationOccurred?.("error"),
  select: () => webApp()?.HapticFeedback?.selectionChanged?.(),
};

/* ---------------- native back button ---------------- */

export function setBackButton(handler) {
  const button = webApp()?.BackButton;
  if (!button) return () => {};
  if (!handler) {
    button.hide();
    return () => {};
  }
  button.show();
  button.onClick(handler);
  return () => {
    button.offClick(handler);
    button.hide();
  };
}

/* ---------------- dialogs ---------------- */

export function showAlert(message) {
  const app = webApp();
  if (app?.showAlert) return new Promise((resolve) => app.showAlert(message, resolve));
  window.alert(message);
  return Promise.resolve();
}

export function showConfirm(message) {
  const app = webApp();
  if (app?.showConfirm) return new Promise((resolve) => app.showConfirm(message, resolve));
  return Promise.resolve(window.confirm(message));
}

/* ---------------- payments ---------------- */

export function openInvoice(link) {
  return new Promise((resolve) => {
    const app = webApp();
    if (!app?.openInvoice) {
      window.open(link, "_blank");
      resolve("unknown");
      return;
    }
    app.openInvoice(link, resolve);
  });
}

/* ---------------- geolocation for Live mode ---------------- */

export function requestLocation() {
  return new Promise((resolve, reject) => {
    const manager = webApp()?.LocationManager;
    if (manager?.getLocation) {
      manager.init?.(() => {
        manager.getLocation((location) => {
          if (location) resolve({ lat: location.latitude, lng: location.longitude });
          else reject(new Error("Геолокация недоступна"));
        });
      });
      return;
    }
    if (!navigator.geolocation) {
      reject(new Error("Геолокация не поддерживается"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude }),
      (error) => reject(new Error(error.message)),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });
}
