import { useState } from 'react';
import {
  Badge,
  Button,
  Card,
  Group,
  Loader,
  Progress,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { IconSearch } from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';
import { useApiQuery } from '@/shared/query';
import { formatDate } from '@/shared/format';

interface StudentRow {
  enrollmentId: string;
  userId: string;
  name: string;
  username: string | null;
  cohort: { id: string; title: string };
  status: string;
  startedAt: string;
  stagesDone: number;
  stagesTotal: number;
  currentStage: { key: string; title: string } | null;
}

const STATUS_LABELS: Record<string, string> = {
  active: 'учится',
  paused: 'пауза',
  withdrawn: 'отчислен',
  completed: 'завершил',
};

export function StudentsPage() {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const navigate = useNavigate();

  const students = useApiQuery<StudentRow[]>(['admin', 'students'], '/admin/students', {
    query: { q: query || undefined, status: status ?? undefined, limit: 200 },
  });

  return (
    <Stack>
      <Title order={2}>Ученики</Title>

      <Card withBorder>
        <Group>
          <TextInput
            flex={1}
            placeholder="Имя или @username"
            leftSection={<IconSearch size={16} />}
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            onKeyDown={(e) => e.key === 'Enter' && setQuery(search)}
          />
          <Select
            placeholder="Статус"
            clearable
            value={status}
            onChange={setStatus}
            data={Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }))}
          />
          <Button onClick={() => setQuery(search)}>Найти</Button>
        </Group>
      </Card>

      <Card withBorder p={0}>
        {students.isLoading ? (
          <Group justify="center" p="xl">
            <Loader />
          </Group>
        ) : (
          <Table highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Ученик</Table.Th>
                <Table.Th>Группа</Table.Th>
                <Table.Th>Статус</Table.Th>
                <Table.Th>Прогресс</Table.Th>
                <Table.Th>Текущий этап</Table.Th>
                <Table.Th>Старт</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(students.data ?? []).map((student) => (
                <Table.Tr key={student.enrollmentId}>
                  <Table.Td>
                    <Text>{student.name}</Text>
                    {student.username ? (
                      <Text size="xs" c="dimmed">
                        @{student.username}
                      </Text>
                    ) : null}
                  </Table.Td>
                  <Table.Td>{student.cohort.title}</Table.Td>
                  <Table.Td>
                    <Badge variant="light">{STATUS_LABELS[student.status] ?? student.status}</Badge>
                  </Table.Td>
                  <Table.Td w={160}>
                    <Progress
                      value={
                        student.stagesTotal > 0
                          ? (student.stagesDone / student.stagesTotal) * 100
                          : 0
                      }
                      size="sm"
                    />
                    <Text size="xs" c="dimmed">
                      {student.stagesDone} из {student.stagesTotal}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" c="dimmed">
                      {student.currentStage?.title ?? '—'}
                    </Text>
                  </Table.Td>
                  <Table.Td>{formatDate(student.startedAt)}</Table.Td>
                  <Table.Td>
                    <Button
                      size="xs"
                      variant="subtle"
                      onClick={() => navigate(`/students/${student.enrollmentId}`)}
                    >
                      Открыть
                    </Button>
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
