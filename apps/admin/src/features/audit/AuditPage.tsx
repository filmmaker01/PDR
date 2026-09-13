import { useState } from 'react';
import {
  Badge,
  Card,
  Code,
  Collapse,
  Group,
  Loader,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useApiQuery } from '@/shared/query';
import { formatDateTime } from '@/shared/format';

interface AuditEntry {
  id: string;
  createdAt: string;
  actorUserId: string | null;
  actorRoleContext: string | null;
  workspaceId: string | null;
  entityType: string;
  entityId: string | null;
  action: string;
  before: unknown;
  after: unknown;
  requestId: string | null;
  ip: string | null;
}

const ACTION_LABELS: Record<string, string> = {
  create: 'создание',
  update: 'изменение',
  delete: 'удаление',
  grant: 'выдача доступа',
  revoke: 'отзыв доступа',
  extend: 'продление',
  suspend: 'приостановка',
  resume: 'возобновление',
  ban: 'блокировка',
  unban: 'разблокировка',
  grant_role: 'назначение роли',
  revoke_role: 'снятие роли',
  revoke_sessions: 'отзыв сессий',
  transfer_ownership: 'передача владения',
};

const ENTITY_LABELS: Record<string, string> = {
  access_grant: 'доступ',
  user: 'пользователь',
  workspace: 'мастерская',
  workspace_member: 'сотрудник',
  invitation: 'приглашение',
};

export function AuditPage() {
  const [entityType, setEntityType] = useState<string | null>(null);
  const [actorUserId, setActorUserId] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const log = useApiQuery<{ items: AuditEntry[]; nextCursor: string | null }>(
    ['admin', 'audit'],
    '/admin/audit',
    {
      query: {
        entityType: entityType ?? undefined,
        actorUserId: actorUserId.length === 36 ? actorUserId : undefined,
        limit: 150,
      },
    },
  );

  return (
    <Stack>
      <Title order={2}>Журнал действий</Title>

      <Card withBorder>
        <Group>
          <Select
            label="Тип объекта"
            placeholder="Все"
            clearable
            value={entityType}
            onChange={setEntityType}
            data={Object.entries(ENTITY_LABELS).map(([value, label]) => ({ value, label }))}
          />
          <TextInput
            label="Автор (ID пользователя)"
            placeholder="UUID"
            value={actorUserId}
            onChange={(e) => setActorUserId(e.currentTarget.value)}
            w={340}
          />
        </Group>
        <Text size="xs" c="dimmed" mt="xs">
          Действия внутри мастерских показываются без содержимого: клиентские базы мастеров
          администратору платформы недоступны.
        </Text>
      </Card>

      <Card withBorder p={0}>
        {log.isLoading ? (
          <Group justify="center" p="xl">
            <Loader />
          </Group>
        ) : (
          <Table highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Когда</Table.Th>
                <Table.Th>Объект</Table.Th>
                <Table.Th>Действие</Table.Th>
                <Table.Th>Автор</Table.Th>
                <Table.Th>Контекст</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(log.data?.items ?? []).map((entry) => (
                <>
                  <Table.Tr
                    key={entry.id}
                    style={{ cursor: 'pointer' }}
                    onClick={() => setExpanded(expanded === entry.id ? null : entry.id)}
                  >
                    <Table.Td>
                      <Text size="sm">{formatDateTime(entry.createdAt)}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{ENTITY_LABELS[entry.entityType] ?? entry.entityType}</Text>
                      {entry.entityId ? (
                        <Text size="xs" c="dimmed">
                          {entry.entityId.slice(0, 8)}
                        </Text>
                      ) : null}
                    </Table.Td>
                    <Table.Td>
                      <Badge variant="light">{ACTION_LABELS[entry.action] ?? entry.action}</Badge>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" c="dimmed">
                        {entry.actorUserId ? entry.actorUserId.slice(0, 8) : 'система'}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" c="dimmed">
                        {entry.actorRoleContext ?? '—'}
                        {entry.workspaceId ? ' · мастерская' : ''}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                  <Table.Tr key={`${entry.id}-details`}>
                    <Table.Td colSpan={5} p={0} style={{ border: 'none' }}>
                      <Collapse in={expanded === entry.id}>
                        <Card withBorder m="xs" bg="var(--mantine-color-default-hover)">
                          <Stack gap="xs">
                            <Text size="xs" c="dimmed">
                              requestId: {entry.requestId ?? '—'} · IP: {entry.ip ?? '—'}
                            </Text>
                            {entry.before ? (
                              <div>
                                <Text size="xs" fw={600}>
                                  До
                                </Text>
                                <Code block>{JSON.stringify(entry.before, null, 2)}</Code>
                              </div>
                            ) : null}
                            {entry.after ? (
                              <div>
                                <Text size="xs" fw={600}>
                                  После
                                </Text>
                                <Code block>{JSON.stringify(entry.after, null, 2)}</Code>
                              </div>
                            ) : null}
                          </Stack>
                        </Card>
                      </Collapse>
                    </Table.Td>
                  </Table.Tr>
                </>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Card>
    </Stack>
  );
}
