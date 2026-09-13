import type { ReactNode } from 'react';
import { Button, Spinner } from '@pdr/ui';
import { useAuth } from './AuthProvider';

/** Пока сессия не установлена, приложение не показывается. */
export function AuthGate({ children }: { children: ReactNode }) {
  const { status, error } = useAuth();

  if (status === 'loading') {
    return (
      <div className="app-splash">
        <Spinner />
        <div className="pdr-hint">Входим…</div>
      </div>
    );
  }

  if (status === 'outside_telegram') {
    return (
      <div className="app-splash">
        <h1 className="pdr-title">Откройте приложение в Telegram</h1>
        <p className="pdr-hint">
          Это приложение работает внутри Telegram: вход выполняется автоматически и подтверждается
          подписью Telegram.
        </p>
      </div>
    );
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
