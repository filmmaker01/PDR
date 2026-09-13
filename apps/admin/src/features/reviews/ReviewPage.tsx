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
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  Title,
} from '@mantine/core';
import { api } from '@/shared/api';
import { useApiMutation, useApiQuery } from '@/shared/query';
import { formatDateTime } from '@/shared/format';

interface ReviewSubmission {
  id: string;
  assignmentKey: string;
  attemptNo: number;
  status: string;
  text: string | null;
  submittedAt: string | null;
  enrollmentId: string;
  student: { id: string; name: string; username: string | null };
  cohort: { id: string; title: string };
  claimedBy: { id: string; name: string; isMe: boolean } | null;
  files: {
    fileId: string;
    mimeType: string;
    previewUrl: string | null;
    originalUrl: string | null;
  }[];
  comments: { id: string; body: string; createdAt: string; author: string; isMine: boolean }[];
  previousAttempts: {
    attemptNo: number;
    status: string;
    submittedAt: string | null;
    review: { decision: string; comment: string } | null;
  }[];
}

export function ReviewPage() {
  const { submissionId = '' } = useParams();
  const navigate = useNavigate();
  const [comment, setComment] = useState('');
  const [question, setQuestion] = useState('');

  const key = ['curator', 'submission', submissionId];
  const submission = useApiQuery<ReviewSubmission>(key, `/curator/submissions/${submissionId}`);

  const claim = useApiMutation(() => api.post(`/curator/submissions/${submissionId}/claim`), {
    invalidate: [key, ['curator', 'queue']],
    successMessage: 'Работа закреплена за вами на 30 минут',
  });
  const release = useApiMutation(() => api.post(`/curator/submissions/${submissionId}/release`), {
    invalidate: [key, ['curator', 'queue']],
  });
  const review = useApiMutation(
    (decision: 'accepted' | 'returned') =>
      api.post(`/curator/submissions/${submissionId}/review`, { decision, comment }),
    {
      invalidate: [['curator']],
      successMessage: 'Решение сохранено, ученик получил уведомление',
      onSuccess: () => navigate('/reviews'),
    },
  );
  const ask = useApiMutation(
    () => api.post(`/curator/submissions/${submissionId}/comments`, { body: question }),
    {
      invalidate: [key],
      successMessage: 'Вопрос отправлен',
      onSuccess: () => setQuestion(''),
    },
  );

  if (submission.isLoading) {
    return (
      <Group justify="center" p="xl">
        <Loader />
      </Group>
    );
  }
  const data = submission.data!;
  const decided = data.status === 'accepted' || data.status === 'returned';
  const heldByOther = data.claimedBy !== null && !data.claimedBy.isMe;

  return (
    <Stack>
      <Group justify="space-between" align="flex-start">
        <div>
          <Title order={2}>{data.student.name}</Title>
          <Text size="sm" c="dimmed">
            Попытка {data.attemptNo} · {data.cohort.title}
            {data.submittedAt ? ` · отправлена ${formatDateTime(data.submittedAt)}` : ''}
          </Text>
        </div>
        <Group>
          <Button variant="subtle" onClick={() => navigate(`/students/${data.enrollmentId}`)}>
            Прогресс ученика
          </Button>
          {data.claimedBy?.isMe ? (
            <Button variant="light" onClick={() => release.mutate(undefined)}>
              Вернуть в очередь
            </Button>
          ) : !data.claimedBy && !decided ? (
            <Button variant="light" onClick={() => claim.mutate(undefined)}>
              Взять на проверку
            </Button>
          ) : null}
        </Group>
      </Group>

      {heldByOther ? (
        <Alert color="yellow">
          Работу сейчас проверяет {data.claimedBy!.name}. Если он не завершит проверку за полчаса,
          работа вернётся в общую очередь.
        </Alert>
      ) : null}

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
        <Alert color="gray">К работе не приложено файлов.</Alert>
      )}

      {data.text ? (
        <Card withBorder>
          <Text fw={600} mb={4}>
            Комментарий ученика
          </Text>
          <Text style={{ whiteSpace: 'pre-wrap' }}>{data.text}</Text>
        </Card>
      ) : null}

      {data.previousAttempts.length > 0 ? (
        <Card withBorder>
          <Text fw={600} mb="xs">
            Предыдущие попытки
          </Text>
          <Stack gap="xs">
            {data.previousAttempts.map((attempt) => (
              <div key={attempt.attemptNo}>
                <Group gap="xs">
                  <Text size="sm" fw={500}>
                    Попытка {attempt.attemptNo}
                  </Text>
                  {attempt.review ? (
                    <Badge
                      size="sm"
                      variant="light"
                      color={attempt.review.decision === 'accepted' ? 'green' : 'yellow'}
                    >
                      {attempt.review.decision === 'accepted' ? 'принята' : 'возвращена'}
                    </Badge>
                  ) : null}
                </Group>
                {attempt.review ? (
                  <Text size="sm" c="dimmed">
                    {attempt.review.comment}
                  </Text>
                ) : null}
              </div>
            ))}
          </Stack>
        </Card>
      ) : null}

      {data.comments.length > 0 ? (
        <Card withBorder>
          <Text fw={600} mb="xs">
            Переписка
          </Text>
          <Stack gap="xs">
            {data.comments.map((c) => (
              <div key={c.id}>
                <Text size="xs" c="dimmed">
                  {c.author}, {formatDateTime(c.createdAt)}
                </Text>
                <Text style={{ whiteSpace: 'pre-wrap' }}>{c.body}</Text>
              </div>
            ))}
          </Stack>
        </Card>
      ) : null}

      {decided ? (
        <Alert color={data.status === 'accepted' ? 'green' : 'yellow'}>
          {data.status === 'accepted' ? 'Работа принята.' : 'Работа возвращена на доработку.'}
        </Alert>
      ) : (
        <Card withBorder>
          <Stack>
            <Textarea
              label="Комментарий"
              description="Обязателен: ученик должен понять, что исправить или что получилось хорошо"
              autosize
              minRows={3}
              value={comment}
              onChange={(e) => setComment(e.currentTarget.value)}
            />
            <Group>
              <Button
                color="green"
                disabled={comment.trim().length === 0 || heldByOther}
                loading={review.isPending}
                onClick={() => review.mutate('accepted')}
              >
                Принять
              </Button>
              <Button
                color="yellow"
                disabled={comment.trim().length === 0 || heldByOther}
                loading={review.isPending}
                onClick={() => review.mutate('returned')}
              >
                Вернуть на доработку
              </Button>
            </Group>
          </Stack>
        </Card>
      )}

      <Card withBorder>
        <Stack>
          <Textarea
            label="Уточняющий вопрос"
            description="Не меняет статус работы: решение останется за вами"
            autosize
            minRows={2}
            value={question}
            onChange={(e) => setQuestion(e.currentTarget.value)}
          />
          <Button
            variant="light"
            disabled={question.trim().length === 0}
            loading={ask.isPending}
            onClick={() => ask.mutate(undefined)}
          >
            Отправить вопрос
          </Button>
        </Stack>
      </Card>
    </Stack>
  );
}
