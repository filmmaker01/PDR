import type { ReactNode } from 'react';
import { Button, Spinner } from '@pdr/ui';
import { useAuth } from './AuthProvider';
import { DemoLoginScreen } from './DemoLoginScreen';

/** Пока сессия не установлена, приложение не показывается. */
export function AuthGate({ children }: { children: ReactNode }) {
  const { status, error, reload } = useAuth();

  if (status === 'loading') {
    return (
      <div className="app-splash">
        <Spinner />
        <div className="pdr-hint">Входим…</div>
      </div>
    );
  }

  if (status === 'outside_telegram') {
    // Вне Telegram работает демо-вход (если он включён на сервере),
    // иначе экран сам объяснит, что приложение открывают из Telegram.
    return <DemoLoginScreen onLoggedIn={() => void reload()} />;
  }

  if (status === 'error') {
    return (
      <div className="app-splash">
        <h1 className="pdr-title">Не удалось войти</h1>
        <p className="pdr-hint">{error}</p>
        <Button onClick={() => window.location.reload()}>Повторить</Button>
      </div>
    );
  }

  return <>{children}</>;
}
