import { useEffect, useState } from 'react';
import { Badge, Button, Card, ListItem, Spinner } from '@pdr/ui';
import { fetchDemoAccounts, loginAsDemo, type DemoAccount } from './demo';

/**
 * Экран выбора демо-аккаунта. Показывается только вне Telegram и только когда
 * сервер подтвердил, что демо-вход включён.
 */
export function DemoLoginScreen({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [accounts, setAccounts] = useState<DemoAccount[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      setAccounts(await fetchDemoAccounts());
      setLoading(false);
    })();
  }, []);

  if (loading) {
    return (
      <div className="app-splash">
        <Spinner />
        <div className="pdr-hint">Проверяем демо-доступ…</div>
      </div>
    );
  }

  if (!accounts || accounts.length === 0) {
    return (
      <div className="app-splash">
        <h1 className="pdr-title">Откройте приложение в Telegram</h1>
        <p className="pdr-hint">
          Приложение работает внутри Telegram: вход выполняется автоматически и подтверждается
          подписью Telegram.
        </p>
      </div>
    );
  }

  const roleLabel = (account: DemoAccount): string => {
    if (account.platformRoles.includes('admin')) return 'администратор';
    if (account.platformRoles.includes('curator')) return 'куратор';
    if (account.workspaces.some((w) => w.role === 'owner')) return 'владелец мастерской';
    if (account.workspaces.length > 0) return 'сотрудник';
    return 'ученик';
  };

  return (
    <div className="pdr-stack" style={{ padding: 16, maxWidth: 520, margin: '0 auto' }}>
      <h1 className="pdr-title">Демо-вход</h1>
      <p className="pdr-hint">
        Это демонстрационное окружение: выберите роль и пройдите приложение так, как его увидит
        пользователь. В рабочем приложении вход выполняет Telegram.
      </p>

      {error ? (
        <Card>
          <div className="pdr-hint">{error}</div>
        </Card>
      ) : null}

      <Card flat>
        <div className="pdr-list">
          {accounts.map((account) => (
            <ListItem
              key={account.key}
              title={account.name}
              subtitle={account.description}
              right={<Badge tone="info">{roleLabel(account)}</Badge>}
              onClick={async () => {
                setPending(account.key);
                setError(null);
                try {
                  await loginAsDemo(account.key);
                  onLoggedIn();
                } catch {
                  setError(
                    'Не удалось войти демо-аккаунтом. Обновите страницу и попробуйте снова.',
                  );
                } finally {
                  setPending(null);
                }
              }}
            />
          ))}
        </div>
      </Card>

      {pending ? (
        <Button block loading disabled>
          Входим…
        </Button>
      ) : null}
    </div>
  );
}
