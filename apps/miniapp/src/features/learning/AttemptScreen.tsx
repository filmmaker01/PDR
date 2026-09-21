import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@pdr/api-client';
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  MediaUploader,
  SkeletonList,
  useUploadQueue,
} from '@pdr/ui';
import { api } from '@/shared/api';
import { createUploadTransport } from '@/shared/uploads';
import { alertDialog, confirmDialog, haptic } from '@/shared/telegram';

interface AttemptQuestion {
  id: string;
  kind: 'single' | 'multiple' | 'boolean' | 'short_text';
  body: string;
  points: number;
  options: { id: string; body: string }[];
  answer: { selectedOptionIds: string[]; textAnswer: string | null } | null;
}

interface AttemptState {
  id: string;
  examKey: string;
  kind: 'test' | 'practical';
  status: string;
  attemptNo: number;
  deadlineAt: string | null;
  secondsLeft: number | null;
  questions: AttemptQuestion[];
}

function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function AttemptScreen() {
  const { enrollmentId = '', attemptId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const attempt = useQuery({
    queryKey: ['learning', 'attempt', attemptId],
    queryFn: () => api.get<AttemptState>(`/learning/attempts/${attemptId}`),
    retry: false,
  });

  const [answers, setAnswers] = useState<Record<string, { options: string[]; text: string }>>({});
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (attempt.data && !loaded) {
      const initial: Record<string, { options: string[]; text: string }> = {};
      for (const question of attempt.data.questions) {
        initial[question.id] = {
          options: question.answer?.selectedOptionIds ?? [],
          text: question.answer?.textAnswer ?? '',
        };
      }
      setAnswers(initial);
      setSecondsLeft(attempt.data.secondsLeft);
      setLoaded(true);
    }
  }, [attempt.data, loaded]);

  const submit = useMutation({
    mutationFn: () =>
      api.post<{ percent: number | null; passed: boolean | null; status: string }>(
        `/learning/attempts/${attemptId}/submit`,
        undefined,
        { idempotencyKey: `submit-${attemptId}` },
      ),
    onSuccess: async () => {
      haptic('success');
      await queryClient.invalidateQueries({ queryKey: ['learning'] });
      navigate(`/learning/${enrollmentId}/attempts/${attemptId}/result`, { replace: true });
    },
    onError: async (e) => {
      haptic('error');
      await alertDialog(e instanceof ApiError ? e.message : 'Не удалось завершить попытку');
    },
  });

  // Таймер и автозавершение по истечении времени.
  useEffect(() => {
    if (secondsLeft === null) return;
    if (secondsLeft <= 0) {
      submit.mutate();
      return;
    }
    const timer = setTimeout(() => setSecondsLeft((v) => (v === null ? null : v - 1)), 1000);
    return () => clearTimeout(timer);
  }, [secondsLeft, submit]);

  const saveAnswer = useMutation({
    mutationFn: (input: { questionId: string; options: string[]; text: string; kind: string }) =>
      api.put(`/learning/attempts/${attemptId}/answers/${input.questionId}`, {
        selectedOptionIds: input.kind === 'short_text' ? [] : input.options,
        textAnswer: input.kind === 'short_text' ? input.text : null,
      }),
  });

  const transport = useMemo(() => createUploadTransport({ scope: 'exam_attempt' }), []);
  const uploads = useUploadQueue({
    transport,
    onUploaded: async (fileId) => {
      await api.post(`/learning/attempts/${attemptId}/files`, { fileId });
    },
  });

  if (attempt.isLoading) return <SkeletonList rows={4} />;
  if (attempt.isError) {
    return (
      <div className="pdr-stack">
        <Card>
          <div className="pdr-hint">
            {attempt.error instanceof ApiError ? attempt.error.message : 'Попытка недоступна'}
          </div>
        </Card>
        <Button variant="secondary" block onClick={() => navigate(`/learning/${enrollmentId}`)}>
          К карте курса
        </Button>
      </div>
    );
  }

  const data = attempt.data!;

  if (data.status !== 'in_progress') {
    navigate(`/learning/${enrollmentId}/attempts/${attemptId}/result`, { replace: true });
    return <SkeletonList rows={2} />;
  }

  if (data.kind === 'practical') {
    return (
      <div className="pdr-stack">
        <h1 className="pdr-title">Практический экзамен</h1>
        <Card>
          <div className="pdr-hint">
            Приложите фотографии и видео выполненной работы. После отправки её оценит куратор.
          </div>
        </Card>
        <Card>
          <MediaUploader
            items={uploads.items}
            onAdd={uploads.add}
            onRetry={uploads.retry}
            onRemove={uploads.remove}
            accept="image/*,video/mp4,video/quicktime"
            capture
            cameraLabel="📷 Снять"
            galleryLabel="🖼 Выбрать из галереи"
          />
        </Card>
        <Button
          block
          disabled={
            uploads.pending || uploads.items.filter((i) => i.status === 'done').length === 0
          }
          loading={submit.isPending}
          onClick={async () => {
            if (await confirmDialog('Отправить работу на оценку?')) submit.mutate();
          }}
        >
          {uploads.pending ? 'Дождитесь загрузки' : 'Отправить на оценку'}
        </Button>
      </div>
    );
  }

  const answered = data.questions.filter((q) => {
    const answer = answers[q.id];
    return q.kind === 'short_text'
      ? Boolean(answer?.text.trim())
      : (answer?.options.length ?? 0) > 0;
  }).length;

  return (
    <div className="pdr-stack">
      <div className="pdr-row">
        <span className="pdr-grow">
          <h1 className="pdr-title" style={{ marginBottom: 0 }}>
            Попытка {data.attemptNo}
          </h1>
          <span className="pdr-hint">
            Отвечено {answered} из {data.questions.length}
          </span>
        </span>
        {secondsLeft !== null ? (
          <Badge tone={secondsLeft < 60 ? 'danger' : 'info'}>{formatCountdown(secondsLeft)}</Badge>
        ) : null}
      </div>

      {data.questions.map((question, index) => {
        const answer = answers[question.id] ?? { options: [], text: '' };
        const update = (next: { options: string[]; text: string }): void => {
          setAnswers((current) => ({ ...current, [question.id]: next }));
          saveAnswer.mutate({
            questionId: question.id,
            options: next.options,
            text: next.text,
            kind: question.kind,
          });
        };

        return (
          <Card key={question.id}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>
              {index + 1}. {question.body}
            </div>

            {question.kind === 'short_text' ? (
              <Field hint="Ответ в одно-два слова">
                <Input
                  value={answer.text}
                  onChange={(e) => update({ options: [], text: e.target.value })}
                  placeholder="Ваш ответ"
                />
              </Field>
            ) : (
              <div className="pdr-stack" style={{ gap: 6 }}>
                {question.options.map((option) => {
                  const selected = answer.options.includes(option.id);
                  return (
                    <label
                      key={option.id}
                      className="pdr-row"
                      style={{
                        padding: 10,
                        borderRadius: 8,
                        border: `1px solid ${selected ? 'var(--pdr-link)' : 'var(--pdr-separator)'}`,
                        cursor: 'pointer',
                      }}
                    >
                      <input
                        type={question.kind === 'multiple' ? 'checkbox' : 'radio'}
                        name={question.id}
                        checked={selected}
                        onChange={() => {
                          const next =
                            question.kind === 'multiple'
                              ? selected
                                ? answer.options.filter((id) => id !== option.id)
                                : [...answer.options, option.id]
                              : [option.id];
                          update({ options: next, text: '' });
                        }}
                        style={{ width: 20, height: 20 }}
                      />
                      <span className="pdr-grow">{option.body}</span>
                    </label>
                  );
                })}
                {question.kind === 'multiple' ? (
                  <div className="pdr-hint">Можно выбрать несколько вариантов</div>
                ) : null}
              </div>
            )}
          </Card>
        );
      })}

      <Button
        block
        loading={submit.isPending}
        onClick={async () => {
          const message =
            answered < data.questions.length
              ? `Без ответа осталось ${data.questions.length - answered}. Завершить попытку?`
              : 'Завершить попытку?';
          if (await confirmDialog(message)) submit.mutate();
        }}
      >
        Завершить
      </Button>
    </div>
  );
}
