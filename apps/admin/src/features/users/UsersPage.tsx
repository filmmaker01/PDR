import { useState } from 'react';
import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Group,
  Loader,
  Menu,
  Modal,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconDots, IconSearch } from '@tabler/icons-react';
import { api } from '@/shared/api';
import { useApiMutation, useApiQuery } from '@/shared/query';
import { formatDate } from '@/shared/format';

interface UserRow {
  id: string;
  telegramUserId: string;
  firstName: string;
  lastName: string | null;
  username: string | null;
  phone: string | null;
  isBanned: boolean;
  botWriteAllowed: boolean;
  platformRoles: string[];
  createdAt: string;
}

export function UsersPage() {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [banTarget, setBanTarget] = useState<UserRow | null>(null);
  const [banReason, setBanReason] = useState('');
  const [opened, { open, close }] = useDisclosure(false);

  const users = useApiQuery<UserRow[]>(['admin', 'users'], '/admin/users', {
    query: { q: query || undefined, limit: 50 },
  });

  const invalidate = [['admin', 'users']];

  const grantRole = useApiMutation(
    ({ userId, role }: { userId: string; role: 'admin' | 'curator' }) =>
      api.post(`/admin/users/${userId}/platform-roles`, { role }),
    { invalidate, successMessage: 'Роль назначена' },
  );
  const revokeRole = useApiMutation(
    ({ userId, role }: { userId: string; role: string }) =>
      api.delete(`/admin/users/${userId}/platform-roles/${role}`),
    { invalidate, successMessage: 'Роль снята' },
  );
  const ban = useApiMutation(
    ({ userId, reason }: { userId: string; reason: string }) =>
      api.post(`/admin/users/${userId}/ban`, { reason }),
    {
      invalidate,
      successMessage: 'Пользователь заблокирован, сессии завершены',
      onSuccess: () => {
        close();
        setBanReason('');
      },
    },
  );
  const unban = useApiMutation((userId: string) => api.post(`/admin/users/${userId}/unban`), {
    invalidate,
    successMessage: 'Блокировка снята',
  });

  return (
    <Stack>
      <Title order={2}>Пользователи</Title>

      <Card withBorder>
        <Group>
          <TextInput
            flex={1}
            placeholder="Имя, @username, телефон или Telegram ID"
            leftSection={<IconSearch size={16} />}
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            onKeyDown={(e) => e.key === 'Enter' && setQuery(search)}
          />
          <Button onClick={() => setQuery(search)}>Найти</Button>
        </Group>
      </Card>

      <Card withBorder p={0}>
        {users.isLoading ? (
          <Group justify="center" p="xl">
            <Loader />
          </Group>
        ) : (
          <Table highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Пользователь</Table.Th>
                <Table.Th>Telegram</Table.Th>
                <Table.Th>Телефон</Table.Th>
                <Table.Th>Роли</Table.Th>
                <Table.Th>Регистрация</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(users.data ?? []).map((u) => (
                <Table.Tr key={u.id}>
                  <Table.Td>
                    <Group gap="xs">
                      <Text>{[u.firstName, u.lastName].filter(Boolean).join(' ')}</Text>
                      {u.isBanned ? (
                        <Badge color="red" size="sm">
                          заблокирован
                        </Badge>
                      ) : null}
                      {!u.botWriteAllowed ? (
                        <Tooltip label="Бот не может писать: уведомления не дойдут">
                          <Badge color="gray" size="sm">
                            без уведомлений
                          </Badge>
                        </Tooltip>
                      ) : null}
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" c="dimmed">
                      {u.username ? `@${u.username}` : u.telegramUserId}
                    </Text>
                  </Table.Td>
                  <Table.Td>{u.phone ?? '—'}</Table.Td>
                  <Table.Td>
                    <Group gap={4}>
                      {u.platformRoles.map((r) => (
                        <Badge key={r} size="sm" color={r === 'admin' ? 'blue' : 'teal'}>
                          {r === 'admin' ? 'админ' : 'куратор'}
                        </Badge>
                      ))}
                    </Group>
                  </Table.Td>
                  <Table.Td>{formatDate(u.createdAt)}</Table.Td>
                  <Table.Td>
                    <Menu position="bottom-end">
                      <Menu.Target>
                        <ActionIcon variant="subtle">
                          <IconDots size={16} />
                        </ActionIcon>
                      </Menu.Target>
                      <Menu.Dropdown>
                        {(['admin', 'curator'] as const).map((role) =>
                          u.platformRoles.includes(role) ? (
                            <Menu.Item
                              key={role}
                              onClick={() => revokeRole.mutate({ userId: u.id, role })}
                            >
                              Снять роль «{role === 'admin' ? 'админ' : 'куратор'}»
                            </Menu.Item>
                          ) : (
                            <Menu.Item
                              key={role}
                              onClick={() => grantRole.mutate({ userId: u.id, role })}
                            >
                              Назначить «{role === 'admin' ? 'админ' : 'куратор'}»
                            </Menu.Item>
                          ),
                        )}
                        <Menu.Divider />
                        {u.isBanned ? (
                          <Menu.Item onClick={() => unban.mutate(u.id)}>Снять блокировку</Menu.Item>
                        ) : (
                          <Menu.Item
                            color="red"
                            onClick={() => {
                              setBanTarget(u);
                              open();
                            }}
                          >
                            Заблокировать
                          </Menu.Item>
                        )}
                      </Menu.Dropdown>
                    </Menu>
                  </Table.Td>
                </Table.Tr>
              ))}
              {users.data?.length === 0 ? (
                <Table.Tr>
                  <Table.Td colSpan={6}>
                    <Text c="dimmed" ta="center" py="md">
                      Никого не найдено
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ) : null}
            </Table.Tbody>
          </Table>
        )}
      </Card>

      <Modal opened={opened} onClose={close} title="Блокировка пользователя">
        <Stack>
          <Text size="sm">
            Все сессии {banTarget?.firstName} будут завершены немедленно. Данные его мастерских
            сохранятся.
          </Text>
          <TextInput
            label="Причина"
            required
            value={banReason}
            onChange={(e) => setBanReason(e.currentTarget.value)}
          />
          <Button
            color="red"
            disabled={banReason.trim().length === 0}
            loading={ban.isPending}
            onClick={() => banTarget && ban.mutate({ userId: banTarget.id, reason: banReason })}
          >
            Заблокировать
          </Button>
        </Stack>
      </Modal>
    </Stack>
  );
}
