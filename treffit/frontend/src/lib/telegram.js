/**
 * Thin wrapper over window.Telegram.WebApp.
 *
 * Everything degrades to a no-op in a plain browser so the app stays
 * runnable with `npm run dev` outside Telegram.
 */

export const tg = typeof window !== "undefined" ? window.Telegram?.WebApp : undefined;

export const isTelegram = Boolean(tg?.initData);

export function initTelegram() {
  if (!tg) return;
  tg.ready();
  tg.expand();
  // Swipe-to-dismiss fights the swipe deck for the same gesture.
  tg.disableVerticalSwipes?.();
  tg.setHeaderColor?.("#FFFFFF");
  tg.setBackgroundColor?.("#F3F6FD");
}

export function getInitData() {
  return tg?.initData || "";
}

export function getViewportHeight() {
  if (tg?.viewportStableHeight) return tg.viewportStableHeight;
  return typeof window !== "undefined" ? window.innerHeight : 720;
}

export function onViewportChange(handler) {
  if (!tg?.onEvent) return () => {};
  tg.onEvent("viewportChanged", handler);
  return () => tg.offEvent("viewportChanged", handler);
}

/* ---------------- haptics ---------------- */

export const haptic = {
  light: () => tg?.HapticFeedback?.impactOccurred?.("light"),
  medium: () => tg?.HapticFeedback?.impactOccurred?.("medium"),
  heavy: () => tg?.HapticFeedback?.impactOccurred?.("heavy"),
  success: () => tg?.HapticFeedback?.notificationOccurred?.("success"),
  warning: () => tg?.HapticFeedback?.notificationOccurred?.("warning"),
  error: () => tg?.HapticFeedback?.notificationOccurred?.("error"),
  select: () => tg?.HapticFeedback?.selectionChanged?.(),
};

/* ---------------- native back button ---------------- */

export function setBackButton(handler) {
  const button = tg?.BackButton;
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
  if (tg?.showAlert) return new Promise((resolve) => tg.showAlert(message, resolve));
  window.alert(message);
  return Promise.resolve();
}

export function showConfirm(message) {
  if (tg?.showConfirm) return new Promise((resolve) => tg.showConfirm(message, resolve));
  return Promise.resolve(window.confirm(message));
}

/* ---------------- payments ---------------- */

export function openInvoice(link) {
  return new Promise((resolve) => {
    if (!tg?.openInvoice) {
      window.open(link, "_blank");
      resolve("unknown");
      return;
    }
    tg.openInvoice(link, resolve);
  });
}

/* ---------------- geolocation for Live mode ---------------- */

export function requestLocation() {
  return new Promise((resolve, reject) => {
    const manager = tg?.LocationManager;
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
