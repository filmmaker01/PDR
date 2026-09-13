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
import { DateTimePicker } from '@mantine/dates';
import { useDisclosure } from '@mantine/hooks';
import { useNavigate } from 'react-router-dom';
import { api } from '@/shared/api';
import { useApiMutation, useApiQuery } from '@/shared/query';
import { formatDate } from '@/shared/format';
import type { CourseSummary } from '../course/types';

interface CohortRow {
  id: string;
  courseId: string;
  courseVersionId: string;
  versionNo: number | null;
  title: string;
  unlockMode: 'interval' | 'dates';
  startsAt: string;
  isActive: boolean;
  studentsCount: number;
}

const KEY = ['admin', 'cohorts'];

export function CohortsPage() {
  const [opened, { open, close }] = useDisclosure(false);
  const navigate = useNavigate();
  const cohorts = useApiQuery<CohortRow[]>(KEY, '/admin/cohorts');

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Группы</Title>
        <Button onClick={open}>Новая группа</Button>
      </Group>

      <Alert color="gray">
        Группа привязана к опубликованной версии курса. Режим «по дате старта ученика» открывает
        этапы через заданное число дней от его личного старта; режим «по датам группы» — в общие
        даты потока. В обоих случаях этап открывается только когда выполнены и срок, и требования
        предыдущего этапа.
      </Alert>

      <Card withBorder p={0}>
        {cohorts.isLoading ? (
          <Group justify="center" p="xl">
            <Loader />
          </Group>
        ) : (
          <Table highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Группа</Table.Th>
                <Table.Th>Версия</Table.Th>
                <Table.Th>Режим открытия</Table.Th>
                <Table.Th>Старт</Table.Th>
                <Table.Th>Учеников</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(cohorts.data ?? []).map((cohort) => (
                <Table.Tr key={cohort.id}>
                  <Table.Td>
                    <Group gap="xs">
                      <Text>{cohort.title}</Text>
                      {!cohort.isActive ? (
                        <Badge color="gray" size="sm">
                          закрыта
                        </Badge>
                      ) : null}
                    </Group>
                  </Table.Td>
                  <Table.Td>№{cohort.versionNo ?? '—'}</Table.Td>
                  <Table.Td>
                    <Badge variant="light">
                      {cohort.unlockMode === 'interval' ? 'по старту ученика' : 'по датам группы'}
                    </Badge>
                  </Table.Td>
                  <Table.Td>{formatDate(cohort.startsAt)}</Table.Td>
                  <Table.Td>{cohort.studentsCount}</Table.Td>
                  <Table.Td>
                    <Button
                      size="xs"
                      variant="subtle"
                      onClick={() => navigate(`/cohorts/${cohort.id}`)}
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

      <CreateCohortModal opened={opened} onClose={close} />
    </Stack>
  );
}

function CreateCohortModal({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const [courseId, setCourseId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [unlockMode, setUnlockMode] = useState<'interval' | 'dates'>('interval');
  const [startsAt, setStartsAt] = useState<Date | null>(new Date());

  const courses = useApiQuery<CourseSummary[]>(['admin', 'courses'], '/admin/courses', {
    enabled: opened,
  });

  const selected = (courses.data ?? []).find((c) => c.id === courseId);
  const hasPublished = selected?.versions.some((v) => v.status === 'published') ?? false;

  const create = useApiMutation(
    () =>
      api.post('/admin/cohorts', {
        courseId,
        title,
        unlockMode,
        startsAt: startsAt?.toISOString(),
      }),
    {
      invalidate: [KEY],
      successMessage: 'Группа создана',
      onSuccess: () => {
        onClose();
        setTitle('');
      },
    },
  );

  return (
    <Modal opened={opened} onClose={onClose} title="Новая группа">
      <Stack>
        <Select
          label="Курс"
          required
          value={courseId}
          onChange={setCourseId}
          data={(courses.data ?? []).map((c) => ({ value: c.id, label: c.title }))}
        />
        {courseId && !hasPublished ? (
          <Alert color="red">
            У курса нет опубликованной версии. Опубликуйте версию перед созданием группы.
          </Alert>
        ) : null}
        <TextInput
          label="Название"
          placeholder="Поток 3, ноябрь"
          required
          value={title}
          onChange={(e) => setTitle(e.currentTarget.value)}
        />
        <Select
          label="Режим открытия этапов"
          value={unlockMode}
          onChange={(v) => setUnlockMode((v as 'interval' | 'dates') ?? 'interval')}
          data={[
            { value: 'interval', label: 'По дате старта ученика (по умолчанию)' },
            { value: 'dates', label: 'По датам группы (поток)' },
          ]}
          description={
            unlockMode === 'interval'
              ? 'Этап открывается через заданное в курсе число дней от личного старта ученика'
              : 'Этап открывается в общую дату; даты задаются в карточке группы'
          }
        />
        <DateTimePicker label="Старт группы" value={startsAt} onChange={setStartsAt} required />
        <Button
          disabled={!courseId || !title.trim() || !hasPublished}
          loading={create.isPending}
          onClick={() => create.mutate(undefined)}
        >
          Создать
        </Button>
      </Stack>
    </Modal>
  );
}
