/**
 * Тонкая обёртка над Telegram WebApp.
 * initData используется только как вход в наш API; initDataUnsafe — никогда как доказательство личности.
 */

export interface TelegramWebApp {
  initData: string;
  initDataUnsafe?: { start_param?: string; user?: { id: number; first_name?: string } };
  version: string;
  platform: string;
  colorScheme: 'light' | 'dark';
  themeParams: Record<string, string>;
  isExpanded: boolean;
  viewportStableHeight: number;
  ready(): void;
  expand(): void;
  close(): void;
  disableVerticalSwipes?(): void;
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
  requestWriteAccess?(cb: (granted: boolean) => void): void;
  requestContact?(cb: (shared: boolean) => void): void;
  openTelegramLink(url: string): void;
  openLink(url: string, options?: { try_instant_view?: boolean }): void;
  showAlert(message: string, cb?: () => void): void;
  showConfirm(message: string, cb: (ok: boolean) => void): void;
  MainButton: {
    text: string;
    isVisible: boolean;
    isActive: boolean;
    setText(text: string): void;
    show(): void;
    hide(): void;
    enable(): void;
    disable(): void;
    showProgress(leaveActive?: boolean): void;
    hideProgress(): void;
    onClick(cb: () => void): void;
    offClick(cb: () => void): void;
  };
  BackButton: {
    isVisible: boolean;
    show(): void;
    hide(): void;
    onClick(cb: () => void): void;
    offClick(cb: () => void): void;
  };
  HapticFeedback?: {
    impactOccurred(style: 'light' | 'medium' | 'heavy'): void;
    notificationOccurred(type: 'error' | 'success' | 'warning'): void;
    selectionChanged(): void;
  };
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

export function getWebApp(): TelegramWebApp | null {
  return typeof window !== 'undefined' ? (window.Telegram?.WebApp ?? null) : null;
}

export function isInsideTelegram(): boolean {
  const wa = getWebApp();
  return Boolean(wa && wa.initData && wa.initData.length > 0);
}

export function getInitData(): string {
  return getWebApp()?.initData ?? '';
}

export function getStartParam(): string | null {
  const wa = getWebApp();
  if (wa?.initDataUnsafe?.start_param) return wa.initDataUnsafe.start_param;
  // Запасной путь: браузер вне Telegram (разработка).
  const url = new URL(window.location.href);
  return url.searchParams.get('startapp') ?? url.searchParams.get('tgWebAppStartParam');
}

export function initTelegram(): void {
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

export function haptic(type: 'success' | 'error' | 'warning' | 'select' | 'light'): void {
  const h = getWebApp()?.HapticFeedback;
  if (!h) return;
  if (type === 'select') h.selectionChanged();
  else if (type === 'light') h.impactOccurred('light');
  else h.notificationOccurred(type);
}

export function requestWriteAccess(): Promise<boolean> {
  const wa = getWebApp();
  return new Promise((resolve) => {
    if (!wa?.requestWriteAccess) return resolve(false);
    wa.requestWriteAccess((granted) => resolve(granted));
  });
}

export function confirmDialog(message: string): Promise<boolean> {
  const wa = getWebApp();
  return new Promise((resolve) => {
    if (!wa) return resolve(window.confirm(message));
    wa.showConfirm(message, (ok) => resolve(ok));
  });
}

export function alertDialog(message: string): Promise<void> {
  const wa = getWebApp();
  return new Promise((resolve) => {
    if (!wa) {
      window.alert(message);
      return resolve();
    }
    wa.showAlert(message, () => resolve());
  });
}

export function shareUrl(url: string, text?: string): void {
  const wa = getWebApp();
  const share = `https://t.me/share/url?url=${encodeURIComponent(url)}${
    text ? `&text=${encodeURIComponent(text)}` : ''
  }`;
  if (wa) wa.openTelegramLink(share);
  else window.open(share, '_blank');
}
