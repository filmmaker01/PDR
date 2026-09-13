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

type Status = 'loading' | 'authenticated' | 'anonymous';

interface AuthState {
  status: Status;
  me: MeResponse | null;
  isAdmin: boolean;
  isCurator: boolean;
  setTokens(tokens: { accessToken: string; refreshToken: string }): Promise<void>;
  reload(): Promise<void>;
  logout(): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth вне AuthProvider');
  return ctx;
}

export function useMe(): MeResponse {
  const { me } = useAuth();
  if (!me) throw new Error('Профиль ещё не загружен');
  return me;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [me, setMe] = useState<MeResponse | null>(null);

  const reload = useCallback(async () => {
    if (!tokenStore.getAccessToken()) {
      setStatus('anonymous');
      setMe(null);
      return;
    }
    try {
      const profile = await api.get<MeResponse>('/me');
      setMe(profile);
      setStatus('authenticated');
    } catch (e) {
      if (e instanceof ApiError && e.isAuthError) {
        tokenStore.clear();
        setMe(null);
        setStatus('anonymous');
        return;
      }
      throw e;
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    setAuthFailureHandler(() => {
      tokenStore.clear();
      setMe(null);
      setStatus('anonymous');
    });
    return () => setAuthFailureHandler(null);
  }, []);

  const setTokens = useCallback(
    async (tokens: { accessToken: string; refreshToken: string }) => {
      tokenStore.setTokens(tokens);
      await reload();
    },
    [reload],
  );

  const logout = useCallback(async () => {
    await api.post('/auth/logout').catch(() => undefined);
    tokenStore.clear();
    setMe(null);
    setStatus('anonymous');
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      status,
      me,
      isAdmin: me?.platformRoles.includes('admin') ?? false,
      isCurator: me?.platformRoles.includes('curator') ?? false,
      setTokens,
      reload,
      logout,
    }),
    [status, me, setTokens, reload, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
