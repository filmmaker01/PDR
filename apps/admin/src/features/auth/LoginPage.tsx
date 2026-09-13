import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Anchor,
  Button,
  Card,
  Center,
  Code,
  Divider,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { ApiError } from '@pdr/api-client';
import { api } from '@/shared/api';
import { useAuth } from './AuthProvider';
import { TelegramLoginButton } from './TelegramLoginButton';
import { demoLogin, fetchDemoAccounts, type DemoAccount } from './demo';

const BOT_USERNAME = import.meta.env.VITE_BOT_USERNAME ?? '';
const POLL_INTERVAL_MS = 2000;

interface Tokens {
  accessToken: string;
  refreshToken: string;
}

export function LoginPage() {
  const { setTokens } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [demoAccounts, setDemoAccounts] = useState<DemoAccount[] | null>(null);
  const [demoPending, setDemoPending] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  // Демо-вход доступен только там, где он включён на сервере (не в production).
  useEffect(() => {
    void (async () => setDemoAccounts(await fetchDemoAccounts()))();
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  const handleWidgetAuth = useCallback(
    async (data: Record<string, unknown>) => {
      setError(null);
      try {
        const tokens = await api.post<Tokens>('/auth/telegram/widget', data, { skipRefresh: true });
        await setTokens(tokens);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'Не удалось войти');
      }
    },
    [setTokens],
  );

  const startBotLogin = useCallback(async () => {
    setError(null);
    setWaiting(true);
    try {
      const created = await api.post<{ code: string; expiresAt: string }>(
        '/auth/web/request',
        undefined,
        { skipRefresh: true },
      );
      setCode(created.code);
      window.open(`https://t.me/${BOT_USERNAME}?start=login_${created.code}`, '_blank');

      stopPolling();
      pollRef.current = window.setInterval(async () => {
        try {
          const status = await api.get<{ status: string } & Partial<Tokens>>(
            `/auth/web/status/${created.code}`,
            { skipRefresh: true },
          );
          if (status.status === 'confirmed' && status.accessToken && status.refreshToken) {
            stopPolling();
            setWaiting(false);
            await setTokens({
              accessToken: status.accessToken,
              refreshToken: status.refreshToken,
            });
          } else if (status.status === 'expired' || status.status === 'used') {
            stopPolling();
            setWaiting(false);
            setError('Запрос на вход устарел. Попробуйте снова.');
          }
        } catch {
          stopPolling();
          setWaiting(false);
          setError('Не удалось проверить статус входа.');
        }
      }, POLL_INTERVAL_MS);
    } catch (e) {
      setWaiting(false);
      setError(e instanceof ApiError ? e.message : 'Не удалось создать запрос на вход');
    }
  }, [setTokens, stopPolling]);

  return (
    <Center mih="100dvh" p="md">
      <Card withBorder shadow="sm" padding="xl" radius="md" w={420} maw="100%">
        <Stack>
          <div>
            <Title order={3}>Панель администратора</Title>
            <Text c="dimmed" size="sm">
              Вход доступен администраторам и кураторам платформы.
            </Text>
          </div>

          {error ? <Alert color="red">{error}</Alert> : null}

          {BOT_USERNAME ? (
            <TelegramLoginButton botUsername={BOT_USERNAME} onAuth={handleWidgetAuth} />
          ) : (
            <Alert color="yellow">
              Не задана переменная <Code>VITE_BOT_USERNAME</Code>: вход через виджет недоступен.
            </Alert>
          )}

          <Divider label="или" labelPosition="center" />

          <Button
            variant="light"
            onClick={startBotLogin}
            loading={waiting}
            disabled={!BOT_USERNAME}
          >
            Подтвердить вход в боте
          </Button>

          {demoAccounts && demoAccounts.length > 0 ? (
            <>
              <Divider label="демо-доступ" labelPosition="center" />
              <Text size="sm" c="dimmed">
                Демонстрационное окружение: вход без Telegram.
              </Text>
              {demoAccounts.map((account) => (
                <Button
                  key={account.key}
                  variant="default"
                  loading={demoPending === account.key}
                  onClick={async () => {
                    setError(null);
                    setDemoPending(account.key);
                    try {
                      await setTokens(await demoLogin(account.key));
                    } catch (e) {
                      setError(e instanceof ApiError ? e.message : 'Не удалось войти');
                    } finally {
                      setDemoPending(null);
                    }
                  }}
                >
                  {account.name} — {account.platformRoles.join(', ')}
                </Button>
              ))}
            </>
          ) : null}

          {code && waiting ? (
            <Text size="sm" c="dimmed">
              Откройте бота и подтвердите вход. Если вкладка не открылась,{' '}
              <Anchor href={`https://t.me/${BOT_USERNAME}?start=login_${code}`} target="_blank">
                перейдите по ссылке
              </Anchor>
              .
            </Text>
          ) : null}
        </Stack>
      </Card>
    </Center>
  );
}
