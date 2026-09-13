import { useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Loader,
  Modal,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { api } from '@/shared/api';
import { useApiMutation, useApiQuery } from '@/shared/query';
import { formatDateTime } from '@/shared/format';

interface Membership {
  userId: string;
  name: string;
  username: string | null;
  telegramUserId: string;
  status: string;
  joinRequestAt: string | null;
  joinedAt: string | null;
  removedAt: string | null;
  lastError: string | null;
  updatedAt: string;
}

interface ClubEvent {
  id: string;
  userId: string | null;
  name: string | null;
  event: string;
  payload: unknown;
  createdAt: string;
}

const STATUS_LABELS: Record<string, string> = {
  none: 'нет',
  invited: 'приглашён',
  join_requested: 'подал заявку',
  approved: 'одобрен',
  member: 'в клубе',
  left: 'вышел',
  removed: 'исключён',
  declined: 'отклонён',
};

const STATUS_COLORS: Record<string, string> = {
  member: 'green',
  approved: 'green',
  join_requested: 'yellow',
  declined: 'red',
  removed: 'red',
  left: 'gray',
  none: 'gray',
  invited: 'blue',
};

const MEMBERSHIPS_KEY = ['admin', 'club', 'memberships'];
const EVENTS_KEY = ['admin', 'club', 'events'];

/** Раздел «Клуб»: состояние членств, ошибки и ручные действия. */
export function ClubPage() {
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [removing, setRemoving] = useState<Membership | null>(null);
  const [reason, setReason] = useState('');
  const [opened, { open, close }] = useDisclosure();

  const memberships = useApiQuery<Membership[]>(MEMBERSHIPS_KEY, '/admin/club/memberships', {
    query: onlyErrors ? { withErrors: true } : {},
  });
  const events = useApiQuery<ClubEvent[]>(EVENTS_KEY, '/admin/club/events');

  const approve = useApiMutation(
    (userId: string) => api.post(`/admin/club/memberships/${userId}/approve`),
    { invalidate: [MEMBERSHIPS_KEY, EVENTS_KEY], successMessage: 'Заявка одобрена' },
  );

  const remove = useApiMutation(
    (vars: { userId: string; reason: string }) =>
      api.post(`/admin/club/memberships/${vars.userId}/remove`, { reason: vars.reason }),
    { invalidate: [MEMBERSHIPS_KEY, EVENTS_KEY], successMessage: 'Исключён из клуба' },
  );

  const runAudit = useApiMutation(() => api.post('/admin/club/audit'), {
    invalidate: [MEMBERSHIPS_KEY, EVENTS_KEY],
    successMessage: 'Сверка выполнена',
  });

  const withErrors = (memberships.data ?? []).filter((row) => row.lastError);

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Закрытый клуб</Title>
        <Group>
          <Button variant="light" onClick={() => setOnlyErrors(!onlyErrors)}>
            {onlyErrors ? 'Показать все' : 'Только с ошибками'}
          </Button>
          <Button loading={runAudit.isPending} onClick={() => runAudit.mutate(undefined)}>
            Сверить с Telegram
          </Button>
        </Group>
      </Group>

      {withErrors.length > 0 && !onlyErrors ? (
        <Alert color="red" title="Есть ошибки обращения к Telegram">
          {withErrors.length} членств(а) с ошибкой. Обычно помогает кнопка «Одобрить» или повтор
          сверки: задача повторяется автоматически, но постоянная ошибка требует проверки прав бота
          в группе.
        </Alert>
      ) : null}

      <Tabs defaultValue="memberships">
        <Tabs.List>
          <Tabs.Tab value="memberships">Членства</Tabs.Tab>
          <Tabs.Tab value="events">События</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="memberships" pt="md">
          <Card withBorder padding="sm">
            {memberships.isLoading ? (
              <Loader />
            ) : (memberships.data?.length ?? 0) === 0 ? (
              <Text c="dimmed">Членств нет.</Text>
            ) : (
              <Table striped highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Пользователь</Table.Th>
                    <Table.Th>Статус</Table.Th>
                    <Table.Th>Вступил</Table.Th>
                    <Table.Th>Ошибка</Table.Th>
                    <Table.Th />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {memberships.data!.map((row) => (
                    <Table.Tr key={row.userId}>
                      <Table.Td>
                        <Text>{row.name}</Text>
                        <Text size="xs" c="dimmed">
                          {row.username ? `@${row.username}` : row.telegramUserId}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Badge color={STATUS_COLORS[row.status] ?? 'gray'}>
                          {STATUS_LABELS[row.status] ?? row.status}
                        </Badge>
                      </Table.Td>
                      <Table.Td>{row.joinedAt ? formatDateTime(row.joinedAt) : '—'}</Table.Td>
                      <Table.Td>
                        {row.lastError ? (
                          <Text size="xs" c="red">
                            {row.lastError}
                          </Text>
                        ) : (
                          '—'
                        )}
                      </Table.Td>
                      <Table.Td>
                        <Group gap="xs" justify="flex-end">
                          <Button
                            size="xs"
                            variant="light"
                            loading={approve.isPending}
                            onClick={() => approve.mutate(row.userId)}
                          >
                            Одобрить
                          </Button>
                          <Button
                            size="xs"
                            color="red"
                            variant="light"
                            onClick={() => {
                              setRemoving(row);
                              setReason('');
                              open();
                            }}
                          >
                            Исключить
                          </Button>
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            )}
          </Card>
        </Tabs.Panel>

        <Tabs.Panel value="events" pt="md">
          <Card withBorder padding="sm">
            {events.isLoading ? (
              <Loader />
            ) : (events.data?.length ?? 0) === 0 ? (
              <Text c="dimmed">Событий нет.</Text>
            ) : (
              <Table striped>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Когда</Table.Th>
                    <Table.Th>Кто</Table.Th>
                    <Table.Th>Событие</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {events.data!.map((event) => (
                    <Table.Tr key={event.id}>
                      <Table.Td>{formatDateTime(event.createdAt)}</Table.Td>
                      <Table.Td>{event.name ?? '—'}</Table.Td>
                      <Table.Td>{event.event}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            )}
          </Card>
        </Tabs.Panel>
      </Tabs>

      <Modal opened={opened} onClose={close} title="Исключение из клуба">
        <Stack>
          <Text size="sm">
            {removing?.name} будет удалён из группы. Вернуться он сможет по ссылке, когда доступ
            продлят.
          </Text>
          <TextInput
            label="Причина"
            value={reason}
            onChange={(e) => setReason(e.currentTarget.value)}
            placeholder="Нарушение правил"
          />
          <Button
            color="red"
            disabled={reason.trim().length < 3}
            loading={remove.isPending}
            onClick={() => {
              if (!removing) return;
              remove.mutate({ userId: removing.userId, reason: reason.trim() });
              close();
            }}
          >
            Исключить
          </Button>
        </Stack>
      </Modal>
    </Stack>
  );
}
