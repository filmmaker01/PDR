import { useState } from 'react';
import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Checkbox,
  Group,
  Modal,
  Select,
  Stack,
  Text,
  TextInput,
  Textarea,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import { api } from '@/shared/api';
import { useApiMutation } from '@/shared/query';
import type { ExamNode, QuestionNode } from './types';

type Kind = 'single' | 'multiple' | 'boolean' | 'short_text';

const KIND_LABELS: Record<Kind, string> = {
  single: 'Один правильный',
  multiple: 'Несколько правильных',
  boolean: 'Да / Нет',
  short_text: 'Короткий ответ',
};

export function QuestionEditor({
  exam,
  editable,
  invalidate,
}: {
  exam: ExamNode;
  editable: boolean;
  invalidate: readonly unknown[];
}) {
  const [opened, { open, close }] = useDisclosure(false);

  return (
    <>
      <Button size="xs" variant="light" onClick={open}>
        Вопросы ({exam.questions.length})
      </Button>
      <Modal opened={opened} onClose={close} title={`Вопросы: ${exam.title}`} size="lg">
        <Stack>
          {exam.questions.map((question) => (
            <QuestionCard
              key={question.id}
              question={question}
              examId={exam.id}
              editable={editable}
              invalidate={invalidate}
            />
          ))}
          {exam.questions.length === 0 ? (
            <Text size="sm" c="dimmed">
              Вопросов пока нет. Тест без вопросов нельзя опубликовать.
            </Text>
          ) : null}
          {editable ? <NewQuestionForm examId={exam.id} invalidate={invalidate} /> : null}
        </Stack>
      </Modal>
    </>
  );
}

function QuestionCard({
  question,
  examId,
  editable,
  invalidate,
}: {
  question: QuestionNode;
  examId: string;
  editable: boolean;
  invalidate: readonly unknown[];
}) {
  void examId;
  const remove = useApiMutation(() => api.delete(`/admin/questions/${question.id}`), {
    invalidate: [invalidate as unknown[]],
  });

  return (
    <Card withBorder padding="sm">
      <Group justify="space-between" align="flex-start">
        <div style={{ flex: 1 }}>
          <Group gap="xs">
            <Text fw={500}>
              {question.position}. {question.body}
            </Text>
            <Badge size="xs" variant="light">
              {KIND_LABELS[question.kind]}
            </Badge>
          </Group>
          {question.kind === 'short_text' ? (
            <Text size="sm" c="dimmed">
              Принимается: {(question.acceptedAnswers ?? []).join(', ')}
            </Text>
          ) : (
            <Stack gap={2} mt={4}>
              {question.options.map((option) => (
                <Text key={option.id} size="sm" c={option.isCorrect ? 'green' : 'dimmed'}>
                  {option.isCorrect ? '✓' : '·'} {option.body}
                </Text>
              ))}
            </Stack>
          )}
        </div>
        {editable ? (
          <ActionIcon color="red" variant="subtle" onClick={() => remove.mutate(undefined)}>
            <IconTrash size={16} />
          </ActionIcon>
        ) : null}
      </Group>
    </Card>
  );
}

function NewQuestionForm({
  examId,
  invalidate,
}: {
  examId: string;
  invalidate: readonly unknown[];
}) {
  const [kind, setKind] = useState<Kind>('single');
  const [body, setBody] = useState('');
  const [explanation, setExplanation] = useState('');
  const [options, setOptions] = useState<{ body: string; isCorrect: boolean }[]>([
    { body: '', isCorrect: true },
    { body: '', isCorrect: false },
  ]);
  const [answers, setAnswers] = useState('');

  const reset = (): void => {
    setBody('');
    setExplanation('');
    setOptions([
      { body: '', isCorrect: true },
      { body: '', isCorrect: false },
    ]);
    setAnswers('');
  };

  const create = useApiMutation(
    () =>
      api.post(`/admin/exams/${examId}/questions`, {
        kind,
        body,
        explanation: explanation || null,
        ...(kind === 'short_text'
          ? {
              acceptedAnswers: answers
                .split('\n')
                .map((a) => a.trim())
                .filter(Boolean),
            }
          : {
              options:
                kind === 'boolean'
                  ? [
                      { body: 'Да', isCorrect: options[0]?.isCorrect ?? true },
                      { body: 'Нет', isCorrect: !(options[0]?.isCorrect ?? true) },
                    ]
                  : options.filter((o) => o.body.trim()),
            }),
      }),
    {
      invalidate: [invalidate as unknown[]],
      successMessage: 'Вопрос добавлен',
      onSuccess: reset,
    },
  );

  const toggleCorrect = (index: number): void => {
    setOptions((current) =>
      current.map((option, i) =>
        kind === 'single'
          ? { ...option, isCorrect: i === index }
          : i === index
            ? { ...option, isCorrect: !option.isCorrect }
            : option,
      ),
    );
  };

  const ready =
    body.trim().length > 0 &&
    (kind === 'short_text'
      ? answers.trim().length > 0
      : kind === 'boolean' || options.filter((o) => o.body.trim()).length >= 2);

  return (
    <Card withBorder bg="var(--mantine-color-default-hover)">
      <Stack>
        <Group>
          <Select
            label="Тип вопроса"
            w={220}
            value={kind}
            onChange={(v) => setKind((v as Kind) ?? 'single')}
            data={Object.entries(KIND_LABELS).map(([value, label]) => ({ value, label }))}
          />
        </Group>
        <Textarea
          label="Вопрос"
          autosize
          minRows={2}
          value={body}
          onChange={(e) => setBody(e.currentTarget.value)}
        />

        {kind === 'short_text' ? (
          <Textarea
            label="Принимаемые ответы"
            description="По одному в строке, регистр не важен"
            autosize
            minRows={2}
            value={answers}
            onChange={(e) => setAnswers(e.currentTarget.value)}
          />
        ) : kind === 'boolean' ? (
          <Checkbox
            label="Правильный ответ — «Да»"
            checked={options[0]?.isCorrect ?? true}
            onChange={(e) =>
              setOptions([
                { body: 'Да', isCorrect: e.currentTarget.checked },
                { body: 'Нет', isCorrect: !e.currentTarget.checked },
              ])
            }
          />
        ) : (
          <Stack gap="xs">
            {options.map((option, index) => (
              <Group key={index} gap="xs">
                <Checkbox checked={option.isCorrect} onChange={() => toggleCorrect(index)} />
                <TextInput
                  flex={1}
                  placeholder={`Вариант ${index + 1}`}
                  value={option.body}
                  onChange={(e) =>
                    setOptions((current) =>
                      current.map((o, i) =>
                        i === index ? { ...o, body: e.currentTarget.value } : o,
                      ),
                    )
                  }
                />
                <ActionIcon
                  variant="subtle"
                  color="red"
                  disabled={options.length <= 2}
                  onClick={() => setOptions((current) => current.filter((_, i) => i !== index))}
                >
                  <IconTrash size={16} />
                </ActionIcon>
              </Group>
            ))}
            <Button
              size="xs"
              variant="subtle"
              leftSection={<IconPlus size={14} />}
              disabled={options.length >= 10}
              onClick={() => setOptions((current) => [...current, { body: '', isCorrect: false }])}
            >
              Ещё вариант
            </Button>
          </Stack>
        )}

        <TextInput
          label="Пояснение после ответа"
          placeholder="Показывается в разборе, если он включён"
          value={explanation}
          onChange={(e) => setExplanation(e.currentTarget.value)}
        />

        <Button
          disabled={!ready}
          loading={create.isPending}
          onClick={() => create.mutate(undefined)}
        >
          Добавить вопрос
        </Button>
      </Stack>
    </Card>
  );
}
