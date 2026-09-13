import { useState } from 'react';
import {
  Badge,
  Button,
  Card,
  Group,
  Loader,
  Select,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core';
import { api } from '@/shared/api';
import { useApiMutation, useApiQuery } from '@/shared/query';
import { formatDateTime } from '@/shared/format';

interface ExportRecord {
  id: string;
  kind: string;
  status: string;
  rowCount: number | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
  ready: boolean;
}

interface Cohort {
  id: string;
  title: string;
}

const KIND_OPTIONS = [
  { value: 'learning_students', label: 'Ученики' },
  { value: 'learning_progress', label: 'Прогресс по этапам' },
  { value: 'audit', label: 'Журнал действий' },
];

const STATUS_COLORS: Record<string, string> = {
  done: 'green',
  failed: 'red',
  running: 'yellow',
  queued: 'gray',
};

const EXPORTS_KEY = ['admin', 'exports'];

/** Выгрузки администратора: обучение и журнал действий. */
export function ExportsPage() {
  const [kind, setKind] = useState<string>('learning_students');
  const [cohortId, setCohortId] = useState<string | null>(null);

  const exports = useApiQuery<ExportRecord[]>(EXPORTS_KEY, '/admin/exports', {
    query: {},
  });
  const cohorts = useApiQuery<Cohort[]>(['admin', 'cohorts'], '/admin/cohorts');

  const request = useApiMutation(
    () =>
      api.post('/admin/exports', {
        kind,
        ...(cohortId && kind !== 'audit' ? { cohortId } : {}),
      }),
    { invalidate: [EXPORTS_KEY], successMessage: 'Выгрузка поставлена в очередь' },
  );

  const download = useApiMutation(
    async (exportId: string) => {
      const link = await api.get<{ url: string }>(`/admin/exports/${exportId}/download`);
      window.open(link.url, '_blank');
      return link;
    },
    { successMessage: 'Файл открыт' },
  );

  return (
    <Stack>
      <Title order={2}>Выгрузки</Title>

      <Card withBorder padding="sm">
        <Group align="flex-end">
          <Select
            label="Что выгрузить"
            data={KIND_OPTIONS}
            value={kind}
            onChange={(value) => setKind(value ?? 'learning_students')}
            w={260}
          />
          {kind !== 'audit' ? (
            <Select
              label="Группа"
              placeholder="Все группы"
              clearable
              data={(cohorts.data ?? []).map((c) => ({ value: c.id, label: c.title }))}
              value={cohortId}
              onChange={setCohortId}
              w={260}
            />
          ) : null}
          <Button loading={request.isPending} onClick={() => request.mutate(undefined)}>
            Заказать
          </Button>
        </Group>
        <Text size="xs" c="dimmed" mt="sm">
          Файл в формате CSV (разделитель «;», UTF-8 с BOM) открывается в Excel. Ссылка живёт
          неделю.
        </Text>
      </Card>

      <Card withBorder padding="sm">
        {exports.isLoading ? (
          <Loader />
        ) : (exports.data?.length ?? 0) === 0 ? (
          <Text c="dimmed">Выгрузок ещё не было.</Text>
        ) : (
          <Table striped>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Что</Table.Th>
                <Table.Th>Статус</Table.Th>
                <Table.Th>Строк</Table.Th>
                <Table.Th>Заказана</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {exports.data!.map((item) => (
                <Table.Tr key={item.id}>
                  <Table.Td>
                    {KIND_OPTIONS.find((o) => o.value === item.kind)?.label ?? item.kind}
                  </Table.Td>
                  <Table.Td>
                    <Badge color={STATUS_COLORS[item.status] ?? 'gray'}>{item.status}</Badge>
                    {item.error ? (
                      <Text size="xs" c="red">
                        {item.error}
                      </Text>
                    ) : null}
                  </Table.Td>
                  <Table.Td>{item.rowCount ?? '—'}</Table.Td>
                  <Table.Td>{formatDateTime(item.createdAt)}</Table.Td>
                  <Table.Td>
                    {item.ready ? (
                      <Button size="xs" variant="light" onClick={() => download.mutate(item.id)}>
                        Скачать
                      </Button>
                    ) : null}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Card>
    </Stack>
  );
}
