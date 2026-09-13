import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Group,
  List,
  Loader,
  Modal,
  Select,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core';
import { IconTrash } from '@tabler/icons-react';
import { useDisclosure } from '@mantine/hooks';
import { api } from '@/shared/api';
import { useApiMutation, useApiQuery } from '@/shared/query';
import { formatDate } from '@/shared/format';
import type { CourseSummary } from '../course/types';

interface CohortDetails {
  id: string;
  courseId: string;
  courseVersionId: string;
  version: { versionNo: number; status: string } | null;
  title: string;
  unlockMode: 'interval' | 'dates';
  startsAt: string;
  isActive: boolean;
  curators: { userId: string; name: string; username: string | null }[];
  students: {
    enrollmentId: string;
    userId: string;
    name: string;
    username: string | null;
    status: string;
    startedAt: string;
  }[];
}

interface UserOption {
  id: string;
  firstName: string;
  lastName: string | null;
  username: string | null;
  platformRoles: string[];
}

interface MigrationReport {
  studentsAffected: number;
  addedStages: string[];
  removedStages: string[];
  addedRequiredLessons: string[];
  addedRequiredAssignments: string[];
  addedRequiredExams: string[];
  stagesReopenedFor: { userId: string; stageKeys: string[] }[];
}

const STATUS_LABELS: Record<string, string> = {
  active: 'учится',
  paused: 'пауза',
  withdrawn: 'отчислен',
  completed: 'завершил',
};

export function CohortPage() {
  const { cohortId = '' } = useParams();
  const navigate = useNavigate();
  const key = ['admin', 'cohort', cohortId];
  const cohort = useApiQuery<CohortDetails>(key, `/admin/cohorts/${cohortId}`);
  const [enrollOpened, enrollHandlers] = useDisclosure(false);
  const [migrateOpened, migrateHandlers] = useDisclosure(false);

  const users = useApiQuery<UserOption[]>(['admin', 'users', 'options'], '/admin/users', {
    query: { limit: 200 },
  });

  const addCurator = useApiMutation(
    (userId: string) => api.post(`/admin/cohorts/${cohortId}/curators`, { userId }),
    { invalidate: [key], successMessage: 'Куратор назначен' },
  );
  const removeCurator = useApiMutation(
    (userId: string) => api.delete(`/admin/cohorts/${cohortId}/curators/${userId}`),
    { invalidate: [key] },
  );

  if (cohort.isLoading) {
    return (
      <Group justify="center" p="xl">
        <Loader />
      </Group>
    );
  }
  const data = cohort.data!;
  const curatorOptions = (users.data ?? []).filter((u) => u.platformRoles.includes('curator'));

  return (
    <Stack>
      <Group justify="space-between" align="flex-start">
        <div>
          <Title order={2}>{data.title}</Title>
          <Text size="sm" c="dimmed">
            Версия №{data.version?.versionNo} · старт {formatDate(data.startsAt)} ·{' '}
            {data.unlockMode === 'interval' ? 'по старту ученика' : 'по датам группы'}
          </Text>
        </div>
        <Group>
          <Button variant="light" onClick={migrateHandlers.open}>
            Перевести на версию
          </Button>
          <Button onClick={enrollHandlers.open}>Зачислить ученика</Button>
        </Group>
      </Group>

      <Card withBorder>
        <Stack gap="xs">
          <Text fw={600}>Кураторы</Text>
          {data.curators.length === 0 ? (
            <Text size="sm" c="dimmed">
              Кураторы не назначены: работы учеников сможет проверять только администратор.
            </Text>
          ) : (
            <Group>
              {data.curators.map((curator) => (
                <Badge
                  key={curator.userId}
                  rightSection={
                    <ActionIcon
                      size="xs"
                      variant="transparent"
                      color="gray"
                      onClick={() => removeCurator.mutate(curator.userId)}
                    >
                      <IconTrash size={12} />
                    </ActionIcon>
                  }
                >
                  {curator.name}
                </Badge>
              ))}
            </Group>
          )}
          <Select
            placeholder="Назначить куратора"
            searchable
            clearable
            w={320}
            data={curatorOptions
              .filter((u) => !data.curators.some((c) => c.userId === u.id))
              .map((u) => ({
                value: u.id,
                label: `${[u.firstName, u.lastName].filter(Boolean).join(' ')}${u.username ? ` (@${u.username})` : ''}`,
              }))}
            onChange={(value) => value && addCurator.mutate(value)}
            description={
              curatorOptions.length === 0
                ? 'Нет пользователей с ролью «куратор» — назначьте роль в разделе «Пользователи»'
                : undefined
            }
          />
        </Stack>
      </Card>

      <Card withBorder p={0}>
        <Table highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Ученик</Table.Th>
              <Table.Th>Статус</Table.Th>
              <Table.Th>Старт обучения</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {data.students.map((student) => (
              <Table.Tr key={student.enrollmentId}>
                <Table.Td>
                  <Text>{student.name}</Text>
                  {student.username ? (
                    <Text size="xs" c="dimmed">
                      @{student.username}
                    </Text>
                  ) : null}
                </Table.Td>
                <Table.Td>
                  <Badge variant="light">{STATUS_LABELS[student.status] ?? student.status}</Badge>
                </Table.Td>
                <Table.Td>{formatDate(student.startedAt)}</Table.Td>
                <Table.Td>
                  <Button
                    size="xs"
                    variant="subtle"
                    onClick={() => navigate(`/students/${student.enrollmentId}`)}
                  >
                    Прогресс
                  </Button>
                </Table.Td>
              </Table.Tr>
            ))}
            {data.students.length === 0 ? (
              <Table.Tr>
                <Table.Td colSpan={4}>
                  <Text c="dimmed" ta="center" py="md">
                    В группе пока нет учеников
                  </Text>
                </Table.Td>
              </Table.Tr>
            ) : null}
          </Table.Tbody>
        </Table>
      </Card>

      <EnrollModal
        opened={enrollOpened}
        onClose={enrollHandlers.close}
        cohortId={cohortId}
        invalidate={key}
        users={users.data ?? []}
        enrolled={data.students.map((s) => s.userId)}
      />
      <MigrateModal
        opened={migrateOpened}
        onClose={migrateHandlers.close}
        cohortId={cohortId}
        courseId={data.courseId}
        currentVersionId={data.courseVersionId}
        invalidate={key}
      />
    </Stack>
  );
}

function EnrollModal({
  opened,
  onClose,
  cohortId,
  invalidate,
  users,
  enrolled,
}: {
  opened: boolean;
  onClose: () => void;
  cohortId: string;
  invalidate: readonly unknown[];
  users: UserOption[];
  enrolled: string[];
}) {
  const [userId, setUserId] = useState<string | null>(null);

  const enroll = useApiMutation(
    () => api.post(`/admin/cohorts/${cohortId}/enrollments`, { userId }),
    {
      invalidate: [invalidate as unknown[], ['admin', 'grants']],
      successMessage: 'Ученик зачислен, доступ к курсу выдан',
      onSuccess: () => {
        onClose();
        setUserId(null);
      },
    },
  );

  return (
    <Modal opened={opened} onClose={onClose} title="Зачисление ученика">
      <Stack>
        <Alert color="blue">
          Зачисление выдаёт доступ к курсу одной операцией. Отдельно выдавать его не нужно.
        </Alert>
        <Select
          label="Ученик"
          required
          searchable
          value={userId}
          onChange={setUserId}
          data={users
            .filter((u) => !enrolled.includes(u.id))
            .map((u) => ({
              value: u.id,
              label: `${[u.firstName, u.lastName].filter(Boolean).join(' ')}${u.username ? ` (@${u.username})` : ''}`,
            }))}
          description="Пользователь должен хотя бы раз открыть приложение в Telegram"
        />
        <Button
          disabled={!userId}
          loading={enroll.isPending}
          onClick={() => enroll.mutate(undefined)}
        >
          Зачислить
        </Button>
      </Stack>
    </Modal>
  );
}

function MigrateModal({
  opened,
  onClose,
  cohortId,
  courseId,
  currentVersionId,
  invalidate,
}: {
  opened: boolean;
  onClose: () => void;
  cohortId: string;
  courseId: string;
  currentVersionId: string;
  invalidate: readonly unknown[];
}) {
  const [versionId, setVersionId] = useState<string | null>(null);
  const [report, setReport] = useState<MigrationReport | null>(null);

  const courses = useApiQuery<CourseSummary[]>(['admin', 'courses'], '/admin/courses', {
    enabled: opened,
  });
  const versions = (courses.data ?? [])
    .find((c) => c.id === courseId)
    ?.versions.filter((v) => v.status === 'published' && v.id !== currentVersionId);

  const preview = useApiMutation(
    () =>
      api.post<{ report: MigrationReport }>(`/admin/cohorts/${cohortId}/migrate-version`, {
        courseVersionId: versionId,
        dryRun: true,
      }),
    { onSuccess: (result) => setReport(result.report) },
  );

  const apply = useApiMutation(
    () =>
      api.post(`/admin/cohorts/${cohortId}/migrate-version`, {
        courseVersionId: versionId,
        dryRun: false,
      }),
    {
      invalidate: [invalidate as unknown[]],
      successMessage: 'Группа переведена на новую версию',
      onSuccess: () => {
        onClose();
        setReport(null);
      },
    },
  );

  return (
    <Modal opened={opened} onClose={onClose} title="Перевод группы на другую версию" size="lg">
      <Stack>
        <Select
          label="Целевая версия"
          placeholder="Выберите опубликованную версию"
          value={versionId}
          onChange={(value) => {
            setVersionId(value);
            setReport(null);
          }}
          data={(versions ?? []).map((v) => ({ value: v.id, label: `Версия №${v.versionNo}` }))}
        />

        {report ? (
          <Alert
            color={report.stagesReopenedFor.length > 0 ? 'yellow' : 'green'}
            title="Что изменится"
          >
            <List size="sm">
              <List.Item>Затронуто учеников: {report.studentsAffected}</List.Item>
              {report.addedStages.length > 0 ? (
                <List.Item>Новые этапы: {report.addedStages.join(', ')}</List.Item>
              ) : null}
              {report.removedStages.length > 0 ? (
                <List.Item>Исчезнут этапы: {report.removedStages.join(', ')}</List.Item>
              ) : null}
              {report.addedRequiredLessons.length > 0 ? (
                <List.Item>
                  Новые обязательные уроки: {report.addedRequiredLessons.join(', ')}
                </List.Item>
              ) : null}
              {report.addedRequiredAssignments.length > 0 ? (
                <List.Item>
                  Новые обязательные задания: {report.addedRequiredAssignments.join(', ')}
                </List.Item>
              ) : null}
              {report.addedRequiredExams.length > 0 ? (
                <List.Item>
                  Новые обязательные экзамены: {report.addedRequiredExams.join(', ')}
                </List.Item>
              ) : null}
              {report.stagesReopenedFor.length > 0 ? (
                <List.Item>
                  У {report.stagesReopenedFor.length} учеников засчитанные этапы снова станут
                  незавершёнными, пока они не выполнят новые требования.
                </List.Item>
              ) : (
                <List.Item>Засчитанные этапы учеников не пострадают.</List.Item>
              )}
            </List>
          </Alert>
        ) : null}

        <Group>
          <Button
            variant="light"
            disabled={!versionId}
            loading={preview.isPending}
            onClick={() => preview.mutate(undefined)}
          >
            Показать последствия
          </Button>
          <Button
            disabled={!report}
            loading={apply.isPending}
            onClick={() => apply.mutate(undefined)}
          >
            Перевести
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
