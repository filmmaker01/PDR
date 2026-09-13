import { Alert, Badge, Card, Grid, Group, Loader, Stack, Text, Title } from '@mantine/core';
import { useApiQuery } from '@/shared/query';
import { formatDateTime } from '@/shared/format';

interface Dashboard {
  users: number;
  workspaces: number;
  grants: { active: number; expiringInWeek: number };
  notifications: Record<string, number>;
  worker: { alive: boolean; lastBeatAt: string | null; instances: number };
  queue: { enabled: boolean };
}

function Stat({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <Card withBorder>
      <Text size="sm" c="dimmed">
        {label}
      </Text>
      <Text fw={700} fz={28}>
        {value}
      </Text>
      {hint ? (
        <Text size="xs" c="dimmed">
          {hint}
        </Text>
      ) : null}
    </Card>
  );
}

export function DashboardPage() {
  const dashboard = useApiQuery<Dashboard>(['admin', 'dashboard'], '/admin/dashboard');

  if (dashboard.isLoading) {
    return (
      <Group justify="center" p="xl">
        <Loader />
      </Group>
    );
  }
  const data = dashboard.data!;

  return (
    <Stack>
      <Title order={2}>Дашборд</Title>

      {!data.worker.alive ? (
        <Alert color="red" title="Фоновый обработчик не отвечает">
          Уведомления, напоминания и обработка файлов не выполняются. Последний сигнал:{' '}
          {formatDateTime(data.worker.lastBeatAt)}.
        </Alert>
      ) : null}

      {data.grants.expiringInWeek > 0 ? (
        <Alert color="yellow" title="Истекают доступы">
          В ближайшую неделю заканчивается {data.grants.expiringInWeek} доступ(ов).
        </Alert>
      ) : null}

      <Grid>
        <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
          <Stat label="Пользователи" value={data.users} />
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
          <Stat label="Мастерские" value={data.workspaces} />
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
          <Stat
            label="Действующие доступы"
            value={data.grants.active}
            hint={`истекают за неделю: ${data.grants.expiringInWeek}`}
          />
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
          <Stat
            label="Уведомления за неделю"
            value={data.notifications.sent ?? 0}
            hint={`пропущено: ${data.notifications.skipped ?? 0}, ошибок: ${data.notifications.failed ?? 0}`}
          />
        </Grid.Col>
      </Grid>

      <Card withBorder>
        <Group justify="space-between">
          <div>
            <Text fw={600}>Фоновый обработчик</Text>
            <Text size="sm" c="dimmed">
              Последний сигнал: {formatDateTime(data.worker.lastBeatAt)} · экземпляров:{' '}
              {data.worker.instances}
            </Text>
          </div>
          <Group>
            <Badge color={data.worker.alive ? 'green' : 'red'}>
              {data.worker.alive ? 'работает' : 'не отвечает'}
            </Badge>
            <Badge color={data.queue.enabled ? 'green' : 'gray'}>
              очередь {data.queue.enabled ? 'активна' : 'отключена'}
            </Badge>
          </Group>
        </Group>
      </Card>
    </Stack>
  );
}
