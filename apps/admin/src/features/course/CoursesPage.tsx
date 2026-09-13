import { useState } from 'react';
import {
  Badge,
  Button,
  Card,
  Group,
  Loader,
  Modal,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
  Title,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { useNavigate } from 'react-router-dom';
import { api } from '@/shared/api';
import { useApiMutation, useApiQuery } from '@/shared/query';
import { formatDate } from '@/shared/format';
import type { CourseSummary } from './types';

const KEY = ['admin', 'courses'];

const STATUS_LABELS: Record<string, string> = {
  draft: 'черновик',
  published: 'опубликована',
  archived: 'архив',
};

export function CoursesPage() {
  const [opened, { open, close }] = useDisclosure(false);
  const navigate = useNavigate();
  const courses = useApiQuery<CourseSummary[]>(KEY, '/admin/courses');

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Курсы</Title>
        <Button onClick={open}>Новый курс</Button>
      </Group>

      {courses.isLoading ? (
        <Group justify="center" p="xl">
          <Loader />
        </Group>
      ) : (
        (courses.data ?? []).map((course) => {
          const draft = course.versions.find((v) => v.status === 'draft');
          const published = course.versions.filter((v) => v.status === 'published');
          return (
            <Card withBorder key={course.id}>
              <Stack>
                <Group justify="space-between" align="flex-start">
                  <div>
                    <Group gap="xs">
                      <Text fw={600} fz="lg">
                        {course.title}
                      </Text>
                      {!course.isActive ? <Badge color="gray">выключен</Badge> : null}
                    </Group>
                    <Text size="sm" c="dimmed">
                      {course.description ?? 'Без описания'}
                    </Text>
                  </div>
                  {draft ? (
                    <Button onClick={() => navigate(`/course/${draft.id}`)}>
                      Редактировать черновик
                    </Button>
                  ) : (
                    <CreateDraftButton courseId={course.id} />
                  )}
                </Group>

                <Table>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Версия</Table.Th>
                      <Table.Th>Статус</Table.Th>
                      <Table.Th>Опубликована</Table.Th>
                      <Table.Th>Изменения</Table.Th>
                      <Table.Th />
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {course.versions.map((v) => (
                      <Table.Tr key={v.id}>
                        <Table.Td>№{v.versionNo}</Table.Td>
                        <Table.Td>
                          <Badge
                            color={v.status === 'published' ? 'green' : 'blue'}
                            variant="light"
                          >
                            {STATUS_LABELS[v.status]}
                          </Badge>
                        </Table.Td>
                        <Table.Td>{formatDate(v.publishedAt)}</Table.Td>
                        <Table.Td>
                          <Text size="sm" c="dimmed" lineClamp={1}>
                            {v.changelog ?? '—'}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Button
                            size="xs"
                            variant="subtle"
                            onClick={() => navigate(`/course/${v.id}`)}
                          >
                            Открыть
                          </Button>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>

                {published.length === 0 ? (
                  <Text size="sm" c="dimmed">
                    Курс ещё не опубликован — группы можно создавать только на опубликованной
                    версии.
                  </Text>
                ) : null}
              </Stack>
            </Card>
          );
        })
      )}

      <CreateCourseModal opened={opened} onClose={close} />
    </Stack>
  );
}

function CreateDraftButton({ courseId }: { courseId: string }) {
  const navigate = useNavigate();
  const create = useApiMutation(
    () => api.post<{ id: string }>(`/admin/courses/${courseId}/draft`),
    {
      invalidate: [KEY],
      onSuccess: (draft) => navigate(`/course/${draft.id}`),
    },
  );
  return (
    <Button loading={create.isPending} onClick={() => create.mutate(undefined)}>
      Создать черновик
    </Button>
  );
}

function CreateCourseModal({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const [slug, setSlug] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  const create = useApiMutation(
    () => api.post('/admin/courses', { slug, title, description: description || null }),
    {
      invalidate: [KEY],
      successMessage: 'Курс создан',
      onSuccess: () => {
        onClose();
        setSlug('');
        setTitle('');
        setDescription('');
      },
    },
  );

  return (
    <Modal opened={opened} onClose={onClose} title="Новый курс">
      <Stack>
        <TextInput
          label="Название"
          required
          value={title}
          onChange={(e) => setTitle(e.currentTarget.value)}
        />
        <TextInput
          label="Адрес"
          required
          description="Латиница и дефисы, например pdr-base"
          value={slug}
          onChange={(e) => setSlug(e.currentTarget.value)}
        />
        <Textarea
          label="Описание"
          autosize
          minRows={2}
          value={description}
          onChange={(e) => setDescription(e.currentTarget.value)}
        />
        <Button
          disabled={!slug.trim() || !title.trim()}
          loading={create.isPending}
          onClick={() => create.mutate(undefined)}
        >
          Создать
        </Button>
      </Stack>
    </Modal>
  );
}
