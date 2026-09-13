import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Image,
  Loader,
  NumberInput,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Textarea,
  Title,
} from '@mantine/core';
import { api } from '@/shared/api';
import { useApiMutation, useApiQuery } from '@/shared/query';
import { formatDateTime } from '@/shared/format';

interface ExamQueueItem {
  id: string;
  examTitle: string;
  passingScore: number;
  attemptNo: number;
  submittedAt: string | null;
  waitingHours: number;
  filesCount: number;
  student: { name: string; username: string | null };
  cohort: { id: string; title: string };
}

export function ExamQueuePage() {
  const navigate = useNavigate();
  const queue = useApiQuery<ExamQueueItem[]>(['curator', 'exam-queue'], '/curator/exam-queue');

  return (
    <Stack>
      <Title order={2}>Практические экзамены</Title>
      <Alert color="gray">
        Тесты проверяются автоматически. Здесь только практические экзамены, которые оценивает
        человек.
      </Alert>

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
                <Table.Th>Экзамен</Table.Th>
                <Table.Th>Попытка</Table.Th>
                <Table.Th>Группа</Table.Th>
                <Table.Th>Ждёт</Table.Th>
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
                    <Text>{item.examTitle}</Text>
                    <Text size="xs" c="dimmed">
                      порог {item.passingScore}% · файлов {item.filesCount}
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
                    <Button size="xs" onClick={() => navigate(`/exam-reviews/${item.id}`)}>
                      Оценить
                    </Button>
                  </Table.Td>
                </Table.Tr>
              ))}
              {queue.data?.length === 0 ? (
                <Table.Tr>
                  <Table.Td colSpan={6}>
                    <Text c="dimmed" ta="center" py="xl">
                      Нет экзаменов, ожидающих оценки
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

interface AttemptForGrading {
  id: string;
  examTitle: string;
  examDescription: string | null;
  passingScore: number;
  attemptNo: number;
  status: string;
  submittedAt: string | null;
  score: number | null;
  passed: boolean | null;
  graderComment: string | null;
  enrollmentId: string;
  student: { id: string; name: string; username: string | null };
  cohort: { id: string; title: string };
  files: {
    fileId: string;
    mimeType: string;
    previewUrl: string | null;
    originalUrl: string | null;
  }[];
}

export function ExamGradingPage() {
  const { attemptId = '' } = useParams();
  const navigate = useNavigate();
  const [score, setScore] = useState<number>(70);
  const [comment, setComment] = useState('');

  const key = ['curator', 'attempt', attemptId];
  const attempt = useApiQuery<AttemptForGrading>(key, `/curator/attempts/${attemptId}`);

  const grade = useApiMutation(
    () => api.post(`/curator/attempts/${attemptId}/grade`, { score, comment }),
    {
      invalidate: [['curator']],
      successMessage: 'Оценка сохранена, ученик получил уведомление',
      onSuccess: () => navigate('/exam-reviews'),
    },
  );

  if (attempt.isLoading) {
    return (
      <Group justify="center" p="xl">
        <Loader />
      </Group>
    );
  }
  const data = attempt.data!;
  const decided = data.status === 'graded';

  return (
    <Stack>
      <Group justify="space-between" align="flex-start">
        <div>
          <Title order={2}>{data.student.name}</Title>
          <Text size="sm" c="dimmed">
            {data.examTitle} · попытка {data.attemptNo} · {data.cohort.title}
            {data.submittedAt ? ` · отправлена ${formatDateTime(data.submittedAt)}` : ''}
          </Text>
        </div>
        <Button variant="subtle" onClick={() => navigate(`/students/${data.enrollmentId}`)}>
          Прогресс ученика
        </Button>
      </Group>

      {data.examDescription ? <Alert color="gray">{data.examDescription}</Alert> : null}

      {data.files.length > 0 ? (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
          {data.files.map((file) =>
            file.mimeType.startsWith('video/') ? (
              <video
                key={file.fileId}
                src={file.originalUrl ?? undefined}
                controls
                style={{ width: '100%', borderRadius: 8, background: '#000' }}
              />
            ) : (
              <a
                key={file.fileId}
                href={file.originalUrl ?? undefined}
                target="_blank"
                rel="noreferrer"
              >
                <Image src={file.previewUrl ?? file.originalUrl} radius="sm" />
              </a>
            ),
          )}
        </SimpleGrid>
      ) : (
        <Alert color="yellow">К экзамену не приложено материалов.</Alert>
      )}

      {decided ? (
        <Alert color={data.passed ? 'green' : 'yellow'}>
          Оценка: {data.score}% (порог {data.passingScore}%).{' '}
          {data.graderComment ? `Комментарий: ${data.graderComment}` : ''}
        </Alert>
      ) : (
        <Card withBorder>
          <Stack>
            <NumberInput
              label="Оценка, %"
              description={`Порог прохождения: ${data.passingScore}%`}
              min={0}
              max={100}
              w={220}
              value={score}
              onChange={(v) => setScore(Number(v) || 0)}
            />
            <Textarea
              label="Комментарий"
              description="Обязателен: ученик должен понять, за что получена оценка"
              autosize
              minRows={3}
              value={comment}
              onChange={(e) => setComment(e.currentTarget.value)}
            />
            <Group>
              <Button
                disabled={comment.trim().length === 0}
                loading={grade.isPending}
                onClick={() => grade.mutate(undefined)}
              >
                {score >= data.passingScore
                  ? 'Поставить оценку (сдано)'
                  : 'Поставить оценку (не сдано)'}
              </Button>
            </Group>
          </Stack>
        </Card>
      )}
    </Stack>
  );
}
