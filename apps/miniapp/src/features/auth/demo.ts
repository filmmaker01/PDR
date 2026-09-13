import { api, tokenStore } from '@/shared/api';

export interface DemoAccount {
  key: string;
  name: string;
  description: string;
  platformRoles: string[];
  workspaces: { id: string; name: string; role: string }[];
  hasCourse: boolean;
  hasClub: boolean;
}

const SECRET_STORAGE_KEY = 'pdr.demo.secret';

/**
 * Секрет демо-входа приходит один раз в ссылке (`?demo=…`) и запоминается,
 * чтобы не тащить его во всех переходах внутри приложения.
 */
export function readDemoSecret(): string | null {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('demo');
    if (fromUrl) {
      localStorage.setItem(SECRET_STORAGE_KEY, fromUrl);
      return fromUrl;
    }
    return localStorage.getItem(SECRET_STORAGE_KEY);
  } catch {
    return null;
  }
}

export async function fetchDemoAccounts(): Promise<DemoAccount[] | null> {
  const secret = readDemoSecret();
  try {
    return await api.get<DemoAccount[]>('/auth/demo/accounts', {
      query: secret ? { secret } : undefined,
      skipRefresh: true,
    });
  } catch {
    // Демо-вход выключен или секрет неверный — это не ошибка приложения.
    return null;
  }
}

export async function loginAsDemo(key: string): Promise<void> {
  const secret = readDemoSecret();
  const tokens = await api.post<{ accessToken: string; refreshToken: string }>(
    '/auth/demo/login',
    { key, secret },
    { skipRefresh: true },
  );
  tokenStore.setTokens(tokens);
}
