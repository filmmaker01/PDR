import { useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Loader,
  Modal,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { api } from '@/shared/api';
import { useApiMutation, useApiQuery } from '@/shared/query';
import { GRANT_STATUS_COLORS, GRANT_STATUS_LABELS, formatDate } from '@/shared/format';

interface WorkspaceRow {
  id: string;
  name: string;
  timezone: string;
  currency: string;
  archivedAt: string | null;
  owner: { userId: string; name: string; username: string | null } | null;
  memberCount: number;
  access: { status: string; validUntil: string | null; grantId: string } | null;
  createdAt: string;
}

interface UserOption {
  id: string;
  firstName: string;
  lastName: string | null;
  username: string | null;
}

const TIMEZONES = [
  'Europe/Kaliningrad',
  'Europe/Moscow',
  'Europe/Samara',
  'Asia/Yekaterinburg',
  'Asia/Omsk',
  'Asia/Krasnoyarsk',
  'Asia/Irkutsk',
  'Asia/Yakutsk',
  'Asia/Vladivostok',
  'Asia/Magadan',
  'Asia/Kamchatka',
  'Europe/Kyiv',
  'Asia/Almaty',
  'Asia/Tashkent',
  'Asia/Tbilisi',
  'Asia/Yerevan',
];

const KEY = ['admin', 'workspaces'];

export function WorkspacesPage() {
  const [opened, { open, close }] = useDisclosure(false);
  const workspaces = useApiQuery<WorkspaceRow[]>(KEY, '/admin/workspaces', {
    query: { limit: 100 },
  });

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Мастерские</Title>
        <Button onClick={open}>Создать мастерскую</Button>
      </Group>

      <Alert color="gray">
        Администратор платформы видит состав участников и состояние доступа, но не содержимое CRM:
        клиенты, заказы, фотографии и оплаты доступны только участникам самой мастерской.
      </Alert>

      <Card withBorder p={0}>
        {workspaces.isLoading ? (
          <Group justify="center" p="xl">
            <Loader />
          </Group>
        ) : (
          <Table highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Название</Table.Th>
                <Table.Th>Владелец</Table.Th>
                <Table.Th>Сотрудников</Table.Th>
                <Table.Th>Часовой пояс</Table.Th>
                <Table.Th>Доступ к CRM</Table.Th>
                <Table.Th>Создана</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(workspaces.data ?? []).map((w) => (
                <Table.Tr key={w.id}>
                  <Table.Td>
                    <Group gap="xs">
                      <Text>{w.name}</Text>
                      {w.archivedAt ? (
                        <Badge color="gray" size="sm">
                          архив
                        </Badge>
                      ) : null}
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{w.owner?.name ?? '—'}</Text>
                    {w.owner?.username ? (
                      <Text size="xs" c="dimmed">
                        @{w.owner.username}
                      </Text>
                    ) : null}
                  </Table.Td>
                  <Table.Td>{w.memberCount}</Table.Td>
                  <Table.Td>
                    <Text size="sm" c="dimmed">
                      {w.timezone}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    {w.access ? (
                      <Group gap={6}>
                        <Badge color={GRANT_STATUS_COLORS[w.access.status]}>
                          {GRANT_STATUS_LABELS[w.access.status]}
                        </Badge>
                        <Text size="xs" c="dimmed">
                          {w.access.validUntil
                            ? `до ${formatDate(w.access.validUntil)}`
                            : 'бессрочно'}
                        </Text>
                      </Group>
                    ) : (
                      <Badge color="gray">нет</Badge>
                    )}
                  </Table.Td>
                  <Table.Td>{formatDate(w.createdAt)}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Card>

      <CreateWorkspaceModal opened={opened} onClose={close} />
    </Stack>
  );
}

function CreateWorkspaceModal({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const [name, setName] = useState('');
  const [ownerUserId, setOwnerUserId] = useState<string | null>(null);
  const [timezone, setTimezone] = useState<string>('Europe/Moscow');
  const [grantAccess, setGrantAccess] = useState(true);

  const users = useApiQuery<UserOption[]>(['admin', 'users', 'options'], '/admin/users', {
    query: { limit: 100 },
    enabled: opened,
  });

  const create = useApiMutation(
    async () => {
      const workspace = await api.post<{ id: string }>('/admin/workspaces', {
        name,
        ownerUserId,
        timezone,
      });
      if (grantAccess) {
        await api.post('/admin/access-grants', {
          product: 'crm',
          workspaceId: workspace.id,
          reason: 'выдано при создании мастерской',
        });
      }
      return workspace;
    },
    {
      invalidate: [KEY, ['admin', 'grants']],
      successMessage: 'Мастерская создана',
      onSuccess: () => {
        onClose();
        setName('');
        setOwnerUserId(null);
      },
    },
  );

  return (
    <Modal opened={opened} onClose={onClose} title="Новая мастерская">
      <Stack>
        <TextInput
          label="Название"
          required
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
        />
        <Select
          label="Владелец"
          required
          searchable
          value={ownerUserId}
          onChange={setOwnerUserId}
          data={(users.data ?? []).map((u) => ({
            value: u.id,
            label: `${[u.firstName, u.lastName].filter(Boolean).join(' ')}${u.username ? ` (@${u.username})` : ''}`,
          }))}
          description="Владелец должен хотя бы раз открыть приложение в Telegram"
        />
        <Select
          label="Часовой пояс"
          searchable
          value={timezone}
          onChange={(v) => setTimezone(v ?? 'Europe/Moscow')}
          data={TIMEZONES}
          description="Определяет «сегодня» в календаре и отчётах"
        />
        <Select
          label="Доступ к CRM"
          value={grantAccess ? 'yes' : 'no'}
          onChange={(v) => setGrantAccess(v === 'yes')}
          data={[
            { value: 'yes', label: 'Выдать сразу, бессрочно' },
            { value: 'no', label: 'Не выдавать' },
          ]}
        />
        <Button
          disabled={!name.trim() || !ownerUserId}
          loading={create.isPending}
          onClick={() => create.mutate(undefined)}
        >
          Создать
        </Button>
      </Stack>
    </Modal>
  );
}
