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
import { useNavigate } from 'react-router-dom';
import { useApiQuery } from '@/shared/query';
import { formatDateTime } from '@/shared/format';

interface QueueItem {
  id: string;
  assignmentTitle: string;
  attemptNo: number;
  status: string;
  submittedAt: string | null;
  waitingHours: number;
  filesCount: number;
  student: { name: string; username: string | null };
  cohort: { id: string; title: string };
  claimedBy: { id: string; name: string; isMe: boolean } | null;
}

interface CuratorCohort {
  id: string;
  title: string;
  courseTitle: string;
  studentsCount: number;
  pendingReviews: number;
}

export function ReviewQueuePage() {
  const [cohortId, setCohortId] = useState<string | null>(null);
  const navigate = useNavigate();

  const cohorts = useApiQuery<CuratorCohort[]>(['curator', 'cohorts'], '/curator/cohorts');
  const queue = useApiQuery<QueueItem[]>(['curator', 'queue'], '/curator/review-queue', {
    query: { cohortId: cohortId ?? undefined, limit: 200 },
  });

  const total = (cohorts.data ?? []).reduce((sum, c) => sum + c.pendingReviews, 0);

  return (
    <Stack>
      <Group justify="space-between">
        <div>
          <Title order={2}>Очередь проверок</Title>
          <Text size="sm" c="dimmed">
            Работ ожидает проверки: {total}
          </Text>
        </div>
        <Select
          placeholder="Все группы"
          clearable
          w={280}
          value={cohortId}
          onChange={setCohortId}
          data={(cohorts.data ?? []).map((c) => ({
            value: c.id,
            label: `${c.title} (${c.pendingReviews})`,
          }))}
        />
      </Group>

      <Card withBorder p={0}>
        {queue.isLoading ? (
          <Group justify="center" p="xl">
            <Loader />
          </Group>
        ) : (
          <Table highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Ученик</Table.Th>
                <Table.Th>Задание</Table.Th>
                <Table.Th>Попытка</Table.Th>
                <Table.Th>Группа</Table.Th>
                <Table.Th>Ждёт</Table.Th>
                <Table.Th>Проверяет</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(queue.data ?? []).map((item) => (
                <Table.Tr key={item.id}>
                  <Table.Td>
                    <Text>{item.student.name}</Text>
                    {item.student.username ? (
                      <Text size="xs" c="dimmed">
                        @{item.student.username}
                      </Text>
                    ) : null}
                  </Table.Td>
                  <Table.Td>
                    <Text>{item.assignmentTitle}</Text>
                    <Text size="xs" c="dimmed">
                      файлов: {item.filesCount}
                    </Text>
                  </Table.Td>
                  <Table.Td>{item.attemptNo}</Table.Td>
                  <Table.Td>{item.cohort.title}</Table.Td>
                  <Table.Td>
                    <Badge
                      variant="light"
                      color={
                        item.waitingHours >= 48
                          ? 'red'
                          : item.waitingHours >= 24
                            ? 'yellow'
                            : 'gray'
                      }
                    >
                      {item.waitingHours} ч
                    </Badge>
                    <Text size="xs" c="dimmed">
                      {formatDateTime(item.submittedAt)}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    {item.claimedBy ? (
                      <Badge color={item.claimedBy.isMe ? 'blue' : 'yellow'} variant="light">
                        {item.claimedBy.isMe ? 'вы' : item.claimedBy.name}
                      </Badge>
                    ) : (
                      <Text size="sm" c="dimmed">
                        свободна
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Button
                      size="xs"
                      onClick={() => navigate(`/reviews/${item.id}`)}
                      disabled={item.claimedBy !== null && !item.claimedBy.isMe}
                    >
                      Проверить
                    </Button>
                  </Table.Td>
                </Table.Tr>
              ))}
              {queue.data?.length === 0 ? (
                <Table.Tr>
                  <Table.Td colSpan={7}>
                    <Text c="dimmed" ta="center" py="xl">
                      Очередь пуста — все работы проверены
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ) : null}
            </Table.Tbody>
          </Table>
        )}
      </Card>
    </Stack>
  );
}
