import { ApiClient, createLocalTokenStore } from '@pdr/api-client';
import { getInitData, isInsideTelegram } from './telegram';
const baseUrl = `${import.meta.env.VITE_API_URL ?? 'http://localhost:3000'}/v1`;
export const tokenStore = createLocalTokenStore('pdr.miniapp');
let authFailureHandler = null;
export function setAuthFailureHandler(handler) {
  authFailureHandler = handler;
}
export const api = new ApiClient({
  baseUrl,
  tokens: tokenStore,
  onAuthFailure: () => authFailureHandler?.(),
  // Внутри Telegram initData доступен всё время работы приложения,
  // поэтому истёкшую сессию можно восстановить без участия пользователя.
  reauthenticate: async () => {
    if (!isInsideTelegram()) return null;
    const res = await fetch(`${baseUrl}/auth/telegram/miniapp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData: getInitData() }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data;
  },
});
//# sourceMappingURL=api.js.map
