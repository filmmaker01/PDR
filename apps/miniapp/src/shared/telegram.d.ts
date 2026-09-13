/**
 * Тонкая обёртка над Telegram WebApp.
 * initData используется только как вход в наш API; initDataUnsafe — никогда как доказательство личности.
 */
export interface TelegramWebApp {
    initData: string;
    initDataUnsafe?: {
        start_param?: string;
        user?: {
            id: number;
            first_name?: string;
        };
    };
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
    openLink(url: string, options?: {
        try_instant_view?: boolean;
    }): void;
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
        Telegram?: {
            WebApp?: TelegramWebApp;
        };
    }
}
export declare function getWebApp(): TelegramWebApp | null;
export declare function isInsideTelegram(): boolean;
export declare function getInitData(): string;
export declare function getStartParam(): string | null;
export declare function initTelegram(): void;
export declare function haptic(type: 'success' | 'error' | 'warning' | 'select' | 'light'): void;
export declare function requestWriteAccess(): Promise<boolean>;
export declare function confirmDialog(message: string): Promise<boolean>;
export declare function alertDialog(message: string): Promise<void>;
export declare function shareUrl(url: string, text?: string): void;
//# sourceMappingURL=telegram.d.ts.map