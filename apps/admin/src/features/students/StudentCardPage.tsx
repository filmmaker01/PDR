import { useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Accordion,
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Loader,
  Modal,
  Progress,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { api } from '@/shared/api';
import { useApiMutation, useApiQuery } from '@/shared/query';
import { formatDate, formatDateTime } from '@/shared/format';

interface LockReason {
  code: string;
  message: string;
}

interface StageBlock {
  key: string;
  title: string;
  access: { status: 'open' | 'locked' | 'completed'; reasons?: LockReason[]; completedAt?: string };
  progress: {
    lessons: { done: number; total: number };
    assignments: { done: number; total: number };
    exams: { done: number; total: number };
  };
  lessons: {
    key: string;
    title: string;
    isRequired: boolean;
    completed: boolean;
    watchPercent: number;
  }[];
}

interface StudentCard {
  enrollmentId: string;
  user: { id: string; name: string; username: string | null; phone: string | null };
  cohort: { id: string; title: string };
  course: { id: string; title: string };
  status: string;
  startedAt: string;
  completedAt: string | null;
  note: string | null;
  access: { active: boolean; validUntil: string | null };
  stages: StageBlock[];
  overrides: {
    id: string;
    stageKey: string;
    action: 'unlock' | 'lock';
    reason: string;
    createdAt: string;
    expiresAt: string | null;
    createdBy: string;
  }[];
}

const ACCESS_LABELS: Record<string, { label: string; color: string }> = {
  open: { label: 'открыт', color: 'blue' },
  completed: { label: 'пройден', color: 'green' },
  locked: { label: 'закрыт', color: 'gray' },
};

export function StudentCardPage() {
  const { enrollmentId = '' } = useParams();
  const key = ['admin', 'enrollment', enrollmentId];
  const card = useApiQuery<StudentCard>(key, `/admin/enrollments/${enrollmentId}`);
  const [overrideTarget, setOverrideTarget] = useState<{
    stageKey: string;
    action: 'unlock' | 'lock';
  } | null>(null);

  const changeStatus = useApiMutation(
    (status: string) => api.patch(`/admin/enrollments/${enrollmentId}`, { status }),
    { invalidate: [key], successMessage: 'Статус обучения изменён' },
  );
  const removeOverride = useApiMutation(
    (overrideId: string) => api.delete(`/admin/stage-overrides/${overrideId}`),
    { invalidate: [key], successMessage: 'Исключение снято' },
  );

  if (card.isLoading) {
    return (
      <Group justify="center" p="xl">
        <Loader />
      </Group>
    );
  }
  const data = card.data!;

  return (
    <Stack>
      <Group justify="space-between" align="flex-start">
        <div>
          <Title order={2}>{data.user.name}</Title>
          <Text size="sm" c="dimmed">
            {data.course.title} · {data.cohort.title} · старт {formatDate(data.startedAt)}
            {data.user.username ? ` · @${data.user.username}` : ''}
          </Text>
        </div>
        <Select
          w={200}
          value={data.status}
          onChange={(value) => value && changeStatus.mutate(value)}
          data={[
            { value: 'active', label: 'Учится' },
            { value: 'paused', label: 'Пауза' },
            { value: 'withdrawn', label: 'Отчислен' },
            { value: 'completed', label: 'Завершил' },
          ]}
        />
      </Group>

      {!data.access.active ? (
        <Alert color="red" title="Доступ к курсу не действует">
          Ученик видит прогресс, но не может открывать уроки и сдавать работы. Продлите доступ в
          разделе «Доступы».
        </Alert>
      ) : data.access.validUntil ? (
        <Alert color="gray">Доступ действует до {formatDate(data.access.validUntil)}.</Alert>
      ) : null}

      {data.overrides.length > 0 ? (
        <Card withBorder>
          <Text fw={600} mb="xs">
            Ручные исключения
          </Text>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Этап</Table.Th>
                <Table.Th>Действие</Table.Th>
                <Table.Th>Причина</Table.Th>
                <Table.Th>Кто и когда</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {data.overrides.map((override) => (
                <Table.Tr key={override.id}>
                  <Table.Td>{override.stageKey}</Table.Td>
                  <Table.Td>
                    <Badge color={override.action === 'unlock' ? 'blue' : 'red'} variant="light">
                      {override.action === 'unlock' ? 'открыт' : 'закрыт'}
                    </Badge>
                  </Table.Td>
                  <Table.Td>{override.reason}</Table.Td>
                  <Table.Td>
                    <Text size="xs" c="dimmed">
                      {override.createdBy}, {formatDateTime(override.createdAt)}
                      {override.expiresAt ? ` (до ${formatDate(override.expiresAt)})` : ''}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Button
                      size="xs"
                      variant="subtle"
                      color="red"
                      onClick={() => removeOverride.mutate(override.id)}
                    >
                      Снять
                    </Button>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Card>
      ) : null}

      <Accordion variant="separated" multiple defaultValue={data.stages.map((s) => s.key)}>
        {data.stages.map((stage, index) => {
          const label = ACCESS_LABELS[stage.access.status] ?? {
            label: 'неизвестно',
            color: 'gray',
          };
          return (
            <Accordion.Item key={stage.key} value={stage.key}>
              <Accordion.Control>
                <Group justify="space-between" pr="md">
                  <Text fw={600}>
                    {index + 1}. {stage.title}
                  </Text>
                  <Group gap="xs">
                    <Badge color={label.color} variant="light">
                      {label.label}
                    </Badge>
                    <Text size="xs" c="dimmed">
                      уроки {stage.progress.lessons.done}/{stage.progress.lessons.total} · практика{' '}
                      {stage.progress.assignments.done}/{stage.progress.assignments.total} ·
                      экзамены {stage.progress.exams.done}/{stage.progress.exams.total}
                    </Text>
                  </Group>
                </Group>
              </Accordion.Control>
              <Accordion.Panel>
                <Stack>
                  {stage.access.status === 'locked' && stage.access.reasons ? (
                    <Alert color="gray">
                      {stage.access.reasons.map((reason) => (
                        <Text key={reason.code} size="sm">
                          • {reason.message}
                        </Text>
                      ))}
                    </Alert>
                  ) : null}

                  <Group>
                    <Button
                      size="xs"
                      variant="light"
                      onClick={() => setOverrideTarget({ stageKey: stage.key, action: 'unlock' })}
                    >
                      Открыть вручную
                    </Button>
                    <Button
                      size="xs"
                      variant="light"
                      color="red"
                      onClick={() => setOverrideTarget({ stageKey: stage.key, action: 'lock' })}
                    >
                      Закрыть вручную
                    </Button>
                  </Group>

                  <Table>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Урок</Table.Th>
                        <Table.Th>Просмотр</Table.Th>
                        <Table.Th>Отметка</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {stage.lessons.map((lesson) => (
                        <Table.Tr key={lesson.key}>
                          <Table.Td>
                            {lesson.title}
                            {!lesson.isRequired ? (
                              <Text span size="xs" c="dimmed">
                                {' '}
                                (необязательный)
                              </Text>
                            ) : null}
                          </Table.Td>
                          <Table.Td w={160}>
                            <Progress value={lesson.watchPercent} size="sm" />
                            <Text size="xs" c="dimmed">
                              {lesson.watchPercent}%
                            </Text>
                          </Table.Td>
                          <Table.Td>
                            {lesson.completed ? (
                              <Badge color="green" variant="light">
                                пройден
                              </Badge>
                            ) : (
                              <Text size="sm" c="dimmed">
                                —
                              </Text>
                            )}
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </Stack>
              </Accordion.Panel>
            </Accordion.Item>
          );
        })}
      </Accordion>

      <OverrideModal
        target={overrideTarget}
        onClose={() => setOverrideTarget(null)}
        enrollmentId={enrollmentId}
        invalidate={key}
      />
    </Stack>
  );
}

function OverrideModal({
  target,
  onClose,
  enrollmentId,
  invalidate,
}: {
  target: { stageKey: string; action: 'unlock' | 'lock' } | null;
  onClose: () => void;
  enrollmentId: string;
  invalidate: readonly unknown[];
}) {
  const [reason, setReason] = useState('');

  const apply = useApiMutation(
    () =>
      api.post(`/admin/enrollments/${enrollmentId}/stage-overrides`, {
        stageKey: target?.stageKey,
        action: target?.action,
        reason,
      }),
    {
      invalidate: [invalidate as unknown[]],
      successMessage: 'Исключение применено',
      onSuccess: () => {
        onClose();
        setReason('');
      },
    },
  );

  return (
    <Modal
      opened={target !== null}
      onClose={onClose}
      title={target?.action === 'unlock' ? 'Открыть этап вручную' : 'Закрыть этап вручную'}
    >
      <Stack>
        <Alert color="gray">
          Ручное решение имеет приоритет над сроками и требованиями. Причина видна ученику и
          сохраняется в журнале.
        </Alert>
        <TextInput
          label="Причина"
          required
          placeholder={
            target?.action === 'unlock' ? 'Перевод из другой школы' : 'Нарушение правил курса'
          }
          value={reason}
          onChange={(e) => setReason(e.currentTarget.value)}
        />
        <Button
          color={target?.action === 'lock' ? 'red' : undefined}
          disabled={reason.trim().length === 0}
          loading={apply.isPending}
          onClick={() => apply.mutate(undefined)}
        >
          Применить
        </Button>
      </Stack>
    </Modal>
  );
}
