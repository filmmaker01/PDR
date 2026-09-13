import { api } from '@/shared/api';

export interface DemoAccount {
  key: string;
  name: string;
  description: string;
  platformRoles: string[];
}

const SECRET_STORAGE_KEY = 'pdr.demo.secret';

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

/** Список демо-аккаунтов. null — демо-вход выключен на сервере. */
export async function fetchDemoAccounts(): Promise<DemoAccount[] | null> {
  const secret = readDemoSecret();
  try {
    const accounts = await api.get<DemoAccount[]>('/auth/demo/accounts', {
      query: secret ? { secret } : undefined,
      skipRefresh: true,
    });
    // В админку пускают только роли платформы: остальные аккаунты не предлагаем.
    return accounts.filter((account) => account.platformRoles.length > 0);
  } catch {
    return null;
  }
}

export async function demoLogin(
  key: string,
): Promise<{ accessToken: string; refreshToken: string }> {
  return api.post<{ accessToken: string; refreshToken: string }>(
    '/auth/demo/login',
    { key, secret: readDemoSecret() },
    { skipRefresh: true },
  );
}
