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

export function getViewportHeight() {
  const app = webApp();
  if (app?.viewportStableHeight) return app.viewportStableHeight;
  return typeof window !== "undefined" ? window.innerHeight : 720;
}

export function onViewportChange(handler) {
  const app = webApp();
  if (!app?.onEvent) return () => {};
  app.onEvent("viewportChanged", handler);
  return () => app.offEvent("viewportChanged", handler);
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
