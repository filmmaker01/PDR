/**
 * Тонкая обёртка над Telegram WebApp.
 * initData используется только как вход в наш API; initDataUnsafe — никогда как доказательство личности.
 */
export function getWebApp() {
  return typeof window !== 'undefined' ? (window.Telegram?.WebApp ?? null) : null;
}
export function isInsideTelegram() {
  const wa = getWebApp();
  return Boolean(wa && wa.initData && wa.initData.length > 0);
}
export function getInitData() {
  return getWebApp()?.initData ?? '';
}
export function getStartParam() {
  const wa = getWebApp();
  if (wa?.initDataUnsafe?.start_param) return wa.initDataUnsafe.start_param;
  // Запасной путь: браузер вне Telegram (разработка).
  const url = new URL(window.location.href);
  return url.searchParams.get('startapp') ?? url.searchParams.get('tgWebAppStartParam');
}
export function initTelegram() {
  const wa = getWebApp();
  if (!wa) return;
  wa.ready();
  wa.expand();
  wa.disableVerticalSwipes?.();
  const bg = wa.themeParams.secondary_bg_color ?? wa.themeParams.bg_color;
  if (bg) {
    wa.setBackgroundColor?.(bg);
    wa.setHeaderColor?.(wa.themeParams.bg_color ?? bg);
  }
  document.documentElement.dataset.tgPlatform = wa.platform;
  document.documentElement.dataset.tgTheme = wa.colorScheme;
}
export function haptic(type) {
  const h = getWebApp()?.HapticFeedback;
  if (!h) return;
  if (type === 'select') h.selectionChanged();
  else if (type === 'light') h.impactOccurred('light');
  else h.notificationOccurred(type);
}
export function requestWriteAccess() {
  const wa = getWebApp();
  return new Promise((resolve) => {
    if (!wa?.requestWriteAccess) return resolve(false);
    wa.requestWriteAccess((granted) => resolve(granted));
  });
}
export function confirmDialog(message) {
  const wa = getWebApp();
  return new Promise((resolve) => {
    if (!wa) return resolve(window.confirm(message));
    wa.showConfirm(message, (ok) => resolve(ok));
  });
}
export function alertDialog(message) {
  const wa = getWebApp();
  return new Promise((resolve) => {
    if (!wa) {
      window.alert(message);
      return resolve();
    }
    wa.showAlert(message, () => resolve());
  });
}
export function shareUrl(url, text) {
  const wa = getWebApp();
  const share = `https://t.me/share/url?url=${encodeURIComponent(url)}${text ? `&text=${encodeURIComponent(text)}` : ''}`;
  if (wa) wa.openTelegramLink(share);
  else window.open(share, '_blank');
}
//# sourceMappingURL=telegram.js.map
