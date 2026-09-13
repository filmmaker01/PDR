import { useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Accordion,
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Group,
  List,
  Loader,
  Modal,
  NumberInput,
  Select,
  Stack,
  Tabs,
  Text,
  TextInput,
  Textarea,
  Title,
  Tooltip,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconArrowDown, IconArrowUp, IconTrash } from '@tabler/icons-react';
import { api } from '@/shared/api';
import { useApiMutation, useApiQuery } from '@/shared/query';
import type { ExamNode, PublishIssue, StageNode, VersionTree, VideoAssetRow } from './types';
import { QuestionEditor } from './QuestionEditor';

export function CourseEditorPage() {
  const { versionId = '' } = useParams();
  const key = ['admin', 'course-version', versionId];
  const version = useApiQuery<VersionTree>(key, `/admin/course-versions/${versionId}`);
  const [publishOpened, publishHandlers] = useDisclosure(false);

  if (version.isLoading) {
    return (
      <Group justify="center" p="xl">
        <Loader />
      </Group>
    );
  }
  const tree = version.data!;
  const editable = tree.status === 'draft';

  return (
    <Stack>
      <Group justify="space-between" align="flex-start">
        <div>
          <Title order={2}>
            Версия №{tree.versionNo}{' '}
            <Badge color={editable ? 'blue' : 'green'} variant="light" ml="xs">
              {editable ? 'черновик' : 'опубликована'}
            </Badge>
          </Title>
          <Text size="sm" c="dimmed">
            {editable
              ? 'Изменения видны только после публикации: идущие группы не затрагиваются.'
              : 'Опубликованная версия неизменяема. Правки вносятся в черновик следующей версии.'}
          </Text>
        </div>
        {editable ? <Button onClick={publishHandlers.open}>Опубликовать</Button> : null}
      </Group>

      {editable ? <AddStageCard versionId={versionId} invalidate={key} /> : null}

      <StageList tree={tree} editable={editable} invalidate={key} />

      <PublishModal
        opened={publishOpened}
        onClose={publishHandlers.close}
        versionId={versionId}
        invalidate={key}
      />
    </Stack>
  );
}

function StageList({
  tree,
  editable,
  invalidate,
}: {
  tree: VersionTree;
  editable: boolean;
  invalidate: readonly unknown[];
}) {
  const reorder = useApiMutation(
    (order: string[]) => api.post(`/admin/course-versions/${tree.id}/stages/reorder`, { order }),
    { invalidate: [invalidate as unknown[]] },
  );
  const removeStage = useApiMutation((stageId: string) => api.delete(`/admin/stages/${stageId}`), {
    invalidate: [invalidate as unknown[]],
    successMessage: 'Этап удалён',
  });

  const move = (index: number, delta: number): void => {
    const ids = tree.stages.map((s) => s.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    reorder.mutate(ids);
  };

  if (tree.stages.length === 0) {
    return <Alert color="gray">В версии пока нет этапов.</Alert>;
  }

  return (
    <Accordion variant="separated" multiple>
      {tree.stages.map((stage, index) => (
        <Accordion.Item key={stage.id} value={stage.id}>
          <Accordion.Control>
            <Group justify="space-between" pr="md">
              <div>
                <Text fw={600}>
                  {index + 1}. {stage.title}
                </Text>
                <Text size="xs" c="dimmed">
                  ключ {stage.key} · открывается через {stage.unlockDaysOffset} дн. от старта
                  ученика
                  {stage.requiresPreviousStage ? ' · требует предыдущий этап' : ''}
                </Text>
              </div>
              <Group gap={4}>
                <Badge variant="light">{stage.lessons.length} уроков</Badge>
                <Badge variant="light" color="grape">
                  {stage.assignments.length} заданий
                </Badge>
                <Badge variant="light" color="teal">
                  {stage.exams.length} экзаменов
                </Badge>
              </Group>
            </Group>
          </Accordion.Control>
          <Accordion.Panel>
            <Stack>
              {editable ? (
                <Group>
                  <Tooltip label="Выше">
                    <ActionIcon
                      variant="subtle"
                      onClick={() => move(index, -1)}
                      disabled={index === 0}
                    >
                      <IconArrowUp size={16} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label="Ниже">
                    <ActionIcon
                      variant="subtle"
                      onClick={() => move(index, 1)}
                      disabled={index === tree.stages.length - 1}
                    >
                      <IconArrowDown size={16} />
                    </ActionIcon>
                  </Tooltip>
                  <StageSettings stage={stage} invalidate={invalidate} />
                  <Button
                    size="xs"
                    color="red"
                    variant="subtle"
                    leftSection={<IconTrash size={14} />}
                    onClick={() => removeStage.mutate(stage.id)}
                  >
                    Удалить этап
                  </Button>
                </Group>
              ) : null}

              <Tabs defaultValue="lessons">
                <Tabs.List>
                  <Tabs.Tab value="lessons">Уроки</Tabs.Tab>
                  <Tabs.Tab value="assignments">Задания</Tabs.Tab>
                  <Tabs.Tab value="exams">Экзамены</Tabs.Tab>
                </Tabs.List>

                <Tabs.Panel value="lessons" pt="sm">
                  <LessonsTab stage={stage} editable={editable} invalidate={invalidate} />
                </Tabs.Panel>
                <Tabs.Panel value="assignments" pt="sm">
                  <AssignmentsTab stage={stage} editable={editable} invalidate={invalidate} />
                </Tabs.Panel>
                <Tabs.Panel value="exams" pt="sm">
                  <ExamsTab stage={stage} editable={editable} invalidate={invalidate} />
                </Tabs.Panel>
              </Tabs>
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>
      ))}
    </Accordion>
  );
}

function StageSettings({
  stage,
  invalidate,
}: {
  stage: StageNode;
  invalidate: readonly unknown[];
}) {
  const [opened, { open, close }] = useDisclosure(false);
  const [title, setTitle] = useState(stage.title);
  const [description, setDescription] = useState(stage.description ?? '');
  const [days, setDays] = useState<number>(stage.unlockDaysOffset);
  const [requiresPrevious, setRequiresPrevious] = useState(stage.requiresPreviousStage);

  const save = useApiMutation(
    () =>
      api.patch(`/admin/stages/${stage.id}`, {
        title,
        description: description || null,
        unlockDaysOffset: days,
        requiresPreviousStage: requiresPrevious,
      }),
    { invalidate: [invalidate as unknown[]], successMessage: 'Этап сохранён', onSuccess: close },
  );

  return (
    <>
      <Button size="xs" variant="light" onClick={open}>
        Настройки этапа
      </Button>
      <Modal opened={opened} onClose={close} title={`Этап «${stage.title}»`}>
        <Stack>
          <TextInput
            label="Название"
            value={title}
            onChange={(e) => setTitle(e.currentTarget.value)}
          />
          <Textarea
            label="Описание"
            autosize
            minRows={2}
            value={description}
            onChange={(e) => setDescription(e.currentTarget.value)}
          />
          <NumberInput
            label="Открывается через, дней от старта ученика"
            description="0 — доступен сразу. Этап откроется только когда пройдёт этот срок И будет выполнен предыдущий этап."
            min={0}
            max={3650}
            value={days}
            onChange={(v) => setDays(Number(v) || 0)}
          />
          <Checkbox
            label="Требовать выполнения предыдущего этапа"
            checked={requiresPrevious}
            onChange={(e) => setRequiresPrevious(e.currentTarget.checked)}
          />
          <Button loading={save.isPending} onClick={() => save.mutate(undefined)}>
            Сохранить
          </Button>
        </Stack>
      </Modal>
    </>
  );
}

function AddStageCard({
  versionId,
  invalidate,
}: {
  versionId: string;
  invalidate: readonly unknown[];
}) {
  const [key, setKey] = useState('');
  const [title, setTitle] = useState('');
  const [days, setDays] = useState<number>(0);

  const create = useApiMutation(
    () =>
      api.post(`/admin/course-versions/${versionId}/stages`, {
        key,
        title,
        unlockDaysOffset: days,
      }),
    {
      invalidate: [invalidate as unknown[]],
      successMessage: 'Этап добавлен',
      onSuccess: () => {
        setKey('');
        setTitle('');
        setDays(0);
      },
    },
  );

  return (
    <Card withBorder>
      <Group align="flex-end">
        <TextInput
          label="Ключ этапа"
          placeholder="stage-1"
          description="Не меняется между версиями: по нему переносится прогресс"
          value={key}
          onChange={(e) => setKey(e.currentTarget.value)}
          w={200}
        />
        <TextInput
          label="Название"
          flex={1}
          value={title}
          onChange={(e) => setTitle(e.currentTarget.value)}
        />
        <NumberInput
          label="Открытие, дней"
          min={0}
          w={150}
          value={days}
          onChange={(v) => setDays(Number(v) || 0)}
        />
        <Button
          disabled={!key.trim() || !title.trim()}
          loading={create.isPending}
          onClick={() => create.mutate(undefined)}
        >
          Добавить этап
        </Button>
      </Group>
    </Card>
  );
}

function LessonsTab({
  stage,
  editable,
  invalidate,
}: {
  stage: StageNode;
  editable: boolean;
  invalidate: readonly unknown[];
}) {
  const [key, setKey] = useState('');
  const [title, setTitle] = useState('');
  const [videoId, setVideoId] = useState<string | null>(null);

  const videos = useApiQuery<VideoAssetRow[]>(['admin', 'videos'], '/admin/videos');
  const create = useApiMutation(
    () =>
      api.post(`/admin/stages/${stage.id}/lessons`, {
        key,
        title,
        videoAssetId: videoId,
        minWatchPercent: 70,
      }),
    {
      invalidate: [invalidate as unknown[]],
      successMessage: 'Урок добавлен',
      onSuccess: () => {
        setKey('');
        setTitle('');
        setVideoId(null);
      },
    },
  );
  const remove = useApiMutation((lessonId: string) => api.delete(`/admin/lessons/${lessonId}`), {
    invalidate: [invalidate as unknown[]],
  });

  return (
    <Stack>
      {stage.lessons.map((lesson, index) => (
        <Card withBorder key={lesson.id} padding="sm">
          <Group justify="space-between">
            <div>
              <Text fw={500}>
                {index + 1}. {lesson.title}
              </Text>
              <Text size="xs" c="dimmed">
                ключ {lesson.key}
                {lesson.isRequired ? ' · обязательный' : ' · необязательный'}
                {lesson.minWatchPercent > 0 ? ` · просмотр от ${lesson.minWatchPercent}%` : ''}
                {lesson.materials.length > 0 ? ` · материалов: ${lesson.materials.length}` : ''}
              </Text>
            </div>
            <Group gap="xs">
              {lesson.video ? (
                <Badge color={lesson.video.status === 'ready' ? 'green' : 'yellow'} variant="light">
                  видео: {lesson.video.status === 'ready' ? 'готово' : lesson.video.status}
                </Badge>
              ) : (
                <Badge color="red" variant="light">
                  без видео
                </Badge>
              )}
              {editable ? (
                <ActionIcon color="red" variant="subtle" onClick={() => remove.mutate(lesson.id)}>
                  <IconTrash size={16} />
                </ActionIcon>
              ) : null}
            </Group>
          </Group>
        </Card>
      ))}

      {editable ? (
        <Card withBorder>
          <Group align="flex-end">
            <TextInput
              label="Ключ"
              placeholder="light"
              w={160}
              value={key}
              onChange={(e) => setKey(e.currentTarget.value)}
            />
            <TextInput
              label="Название урока"
              flex={1}
              value={title}
              onChange={(e) => setTitle(e.currentTarget.value)}
            />
            <Select
              label="Видео"
              placeholder="Выберите"
              searchable
              clearable
              w={240}
              value={videoId}
              onChange={setVideoId}
              data={(videos.data ?? []).map((v) => ({
                value: v.id,
                label: `${v.title}${v.status === 'ready' ? '' : ` (${v.status})`}`,
              }))}
            />
            <Button
              disabled={!key.trim() || !title.trim()}
              loading={create.isPending}
              onClick={() => create.mutate(undefined)}
            >
              Добавить урок
            </Button>
          </Group>
        </Card>
      ) : null}
    </Stack>
  );
}

function AssignmentsTab({
  stage,
  editable,
  invalidate,
}: {
  stage: StageNode;
  editable: boolean;
  invalidate: readonly unknown[];
}) {
  const [key, setKey] = useState('');
  const [title, setTitle] = useState('');
  const [instructions, setInstructions] = useState('');
  const [minPhotos, setMinPhotos] = useState(1);
  const [minVideos, setMinVideos] = useState(0);

  const create = useApiMutation(
    () =>
      api.post(`/admin/stages/${stage.id}/assignments`, {
        key,
        title,
        instructions,
        requiredMedia: { min_photos: minPhotos, min_videos: minVideos, text_required: true },
      }),
    {
      invalidate: [invalidate as unknown[]],
      successMessage: 'Задание добавлено',
      onSuccess: () => {
        setKey('');
        setTitle('');
        setInstructions('');
      },
    },
  );
  const remove = useApiMutation(
    (assignmentId: string) => api.delete(`/admin/assignments/${assignmentId}`),
    { invalidate: [invalidate as unknown[]] },
  );

  return (
    <Stack>
      {stage.assignments.map((assignment) => (
        <Card withBorder key={assignment.id} padding="sm">
          <Group justify="space-between" align="flex-start">
            <div style={{ flex: 1 }}>
              <Text fw={500}>{assignment.title}</Text>
              <Text size="xs" c="dimmed">
                ключ {assignment.key} · фото от {assignment.requiredMedia.min_photos ?? 0}
                {assignment.requiredMedia.min_videos
                  ? `, видео от ${assignment.requiredMedia.min_videos}`
                  : ''}
                {assignment.isRequired ? ' · обязательное' : ''}
              </Text>
              <Text size="sm" mt={4} lineClamp={2}>
                {assignment.instructions}
              </Text>
            </div>
            {editable ? (
              <ActionIcon color="red" variant="subtle" onClick={() => remove.mutate(assignment.id)}>
                <IconTrash size={16} />
              </ActionIcon>
            ) : null}
          </Group>
        </Card>
      ))}

      {editable ? (
        <Card withBorder>
          <Stack>
            <Group align="flex-end">
              <TextInput
                label="Ключ"
                placeholder="practice-1"
                w={180}
                value={key}
                onChange={(e) => setKey(e.currentTarget.value)}
              />
              <TextInput
                label="Название"
                flex={1}
                value={title}
                onChange={(e) => setTitle(e.currentTarget.value)}
              />
              <NumberInput
                label="Фото, мин."
                w={110}
                min={0}
                max={20}
                value={minPhotos}
                onChange={(v) => setMinPhotos(Number(v) || 0)}
              />
              <NumberInput
                label="Видео, мин."
                w={110}
                min={0}
                max={5}
                value={minVideos}
                onChange={(v) => setMinVideos(Number(v) || 0)}
              />
            </Group>
            <Textarea
              label="Инструкция для ученика"
              autosize
              minRows={3}
              value={instructions}
              onChange={(e) => setInstructions(e.currentTarget.value)}
            />
            <Button
              disabled={!key.trim() || !title.trim() || !instructions.trim()}
              loading={create.isPending}
              onClick={() => create.mutate(undefined)}
            >
              Добавить задание
            </Button>
          </Stack>
        </Card>
      ) : null}
    </Stack>
  );
}

function ExamsTab({
  stage,
  editable,
  invalidate,
}: {
  stage: StageNode;
  editable: boolean;
  invalidate: readonly unknown[];
}) {
  const [key, setKey] = useState('');
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<'test' | 'practical'>('test');
  const [passingScore, setPassingScore] = useState(70);

  const create = useApiMutation(
    () => api.post(`/admin/stages/${stage.id}/exams`, { key, title, kind, passingScore }),
    {
      invalidate: [invalidate as unknown[]],
      successMessage: 'Экзамен добавлен',
      onSuccess: () => {
        setKey('');
        setTitle('');
      },
    },
  );
  const remove = useApiMutation((examId: string) => api.delete(`/admin/exams/${examId}`), {
    invalidate: [invalidate as unknown[]],
  });

  return (
    <Stack>
      {stage.exams.map((exam: ExamNode) => (
        <Card withBorder key={exam.id} padding="sm">
          <Group justify="space-between" align="flex-start">
            <div style={{ flex: 1 }}>
              <Group gap="xs">
                <Text fw={500}>{exam.title}</Text>
                <Badge variant="light" color={exam.kind === 'test' ? 'blue' : 'grape'}>
                  {exam.kind === 'test' ? 'тест' : 'практика'}
                </Badge>
              </Group>
              <Text size="xs" c="dimmed">
                ключ {exam.key} · порог {exam.passingScore}%
                {exam.maxAttempts ? ` · попыток ${exam.maxAttempts}` : ' · попытки не ограничены'}
                {exam.cooldownHours ? ` · пауза ${exam.cooldownHours} ч` : ''}
                {exam.kind === 'test' ? ` · вопросов ${exam.questions.length}` : ''}
              </Text>
            </div>
            <Group gap="xs">
              {exam.kind === 'test' ? (
                <QuestionEditor exam={exam} editable={editable} invalidate={invalidate} />
              ) : null}
              {editable ? (
                <ActionIcon color="red" variant="subtle" onClick={() => remove.mutate(exam.id)}>
                  <IconTrash size={16} />
                </ActionIcon>
              ) : null}
            </Group>
          </Group>
        </Card>
      ))}

      {editable ? (
        <Card withBorder>
          <Group align="flex-end">
            <TextInput
              label="Ключ"
              placeholder="test-1"
              w={160}
              value={key}
              onChange={(e) => setKey(e.currentTarget.value)}
            />
            <TextInput
              label="Название"
              flex={1}
              value={title}
              onChange={(e) => setTitle(e.currentTarget.value)}
            />
            <Select
              label="Тип"
              w={180}
              value={kind}
              onChange={(v) => setKind((v as 'test' | 'practical') ?? 'test')}
              data={[
                { value: 'test', label: 'Тест (автопроверка)' },
                { value: 'practical', label: 'Практический (куратор)' },
              ]}
            />
            <NumberInput
              label="Порог, %"
              w={110}
              min={0}
              max={100}
              value={passingScore}
              onChange={(v) => setPassingScore(Number(v) || 0)}
            />
            <Button
              disabled={!key.trim() || !title.trim()}
              loading={create.isPending}
              onClick={() => create.mutate(undefined)}
            >
              Добавить
            </Button>
          </Group>
        </Card>
      ) : null}
    </Stack>
  );
}

function PublishModal({
  opened,
  onClose,
  versionId,
  invalidate,
}: {
  opened: boolean;
  onClose: () => void;
  versionId: string;
  invalidate: readonly unknown[];
}) {
  const [changelog, setChangelog] = useState('');
  const validation = useApiQuery<{ ready: boolean; issues: PublishIssue[] }>(
    ['admin', 'course-version', versionId, 'validate'],
    `/admin/course-versions/${versionId}/validate`,
    { enabled: opened },
  );

  const publish = useApiMutation(
    () => api.post(`/admin/course-versions/${versionId}/publish`, { changelog: changelog || null }),
    {
      invalidate: [invalidate as unknown[], ['admin', 'courses']],
      successMessage: 'Версия опубликована',
      onSuccess: onClose,
    },
  );

  return (
    <Modal opened={opened} onClose={onClose} title="Публикация версии" size="lg">
      <Stack>
        {validation.isLoading ? (
          <Loader />
        ) : validation.data?.ready ? (
          <Alert color="green">
            Проверка пройдена. После публикации версия станет неизменяемой, а для дальнейших правок
            создастся новый черновик.
          </Alert>
        ) : (
          <Alert color="red" title="Курс не готов к публикации">
            <List size="sm">
              {(validation.data?.issues ?? []).map((issue) => (
                <List.Item key={`${issue.path}-${issue.message}`}>{issue.message}</List.Item>
              ))}
            </List>
          </Alert>
        )}
        <Textarea
          label="Что изменилось"
          placeholder="Коротко для истории версий"
          autosize
          minRows={2}
          value={changelog}
          onChange={(e) => setChangelog(e.currentTarget.value)}
        />
        <Button
          disabled={!validation.data?.ready}
          loading={publish.isPending}
          onClick={() => publish.mutate(undefined)}
        >
          Опубликовать
        </Button>
      </Stack>
    </Modal>
  );
}
