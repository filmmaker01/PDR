import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { MeResponse } from '@pdr/shared';
import { ApiError } from '@pdr/api-client';
import { api, setAuthFailureHandler, tokenStore } from '@/shared/api';
import { getInitData, getStartParam, isInsideTelegram } from '@/shared/telegram';

type AuthStatus = 'loading' | 'authenticated' | 'outside_telegram' | 'error';

interface AuthState {
  status: AuthStatus;
  me: MeResponse | null;
  error: string | null;
  startAction: string | null;
  reload: () => Promise<void>;
  clearStartAction: () => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth вне AuthProvider');
  return ctx;
}

/** Для экранов, которым профиль обязателен. */
export function useMe(): MeResponse {
  const { me } = useAuth();
  if (!me) throw new Error('Профиль ещё не загружен');
  return me;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [me, setMe] = useState<MeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [startAction, setStartAction] = useState<string | null>(null);

  const loadProfile = useCallback(async () => {
    const profile = await api.get<MeResponse>('/me');
    setMe(profile);
    setStatus('authenticated');
  }, []);

  const login = useCallback(async () => {
    if (!isInsideTelegram()) {
      setStatus('outside_telegram');
      return;
    }
    const result = await api.post<{
      accessToken: string;
      refreshToken: string;
      startAction: string | null;
    }>('/auth/telegram/miniapp', { initData: getInitData() }, { skipRefresh: true });

    tokenStore.setTokens(result);
    setStartAction(result.startAction ?? getStartParam());
    await loadProfile();
  }, [loadProfile]);

  const bootstrap = useCallback(async () => {
    setStatus('loading');
    setError(null);
    try {
      if (tokenStore.getAccessToken()) {
        try {
          await loadProfile();
          setStartAction((current) => current ?? getStartParam());
          return;
        } catch (e) {
          if (!(e instanceof ApiError) || !e.isAuthError) throw e;
        }
      }
      await login();
    } catch (e) {
      const message =
        e instanceof ApiError ? e.message : 'Не удалось подключиться к серверу. Проверьте интернет';
      setError(message);
      setStatus('error');
    }
  }, [loadProfile, login]);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    setAuthFailureHandler(() => {
      tokenStore.clear();
      void bootstrap();
    });
    return () => setAuthFailureHandler(null);
  }, [bootstrap]);

  const logout = useCallback(async () => {
    await api.post('/auth/logout').catch(() => undefined);
    tokenStore.clear();
    setMe(null);
    await bootstrap();
  }, [bootstrap]);

  const value = useMemo<AuthState>(
    () => ({
      status,
      me,
      error,
      startAction,
      reload: loadProfile,
      clearStartAction: () => setStartAction(null),
      logout,
    }),
    [status, me, error, startAction, loadProfile, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
