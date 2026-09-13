import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@pdr/api-client';
import { Badge, Button, Card, ErrorState, ListItem, SkeletonList } from '@pdr/ui';
import { api } from '@/shared/api';
import { formatDateTime, formatDuration, plural } from '@/shared/format';
import { alertDialog, confirmDialog } from '@/shared/telegram';

interface ExamDetails {
  key: string;
  stageKey: string;
  title: string;
  kind: 'test' | 'practical';
  description: string | null;
  passingScore: number;
  maxAttempts: number | null;
  timeLimitSec: number | null;
  cooldownHours: number;
  questionsCount: number | null;
  passed: boolean;
  availability: {
    canStart: boolean;
    reason: string | null;
    attemptsUsed: number;
    attemptsLeft: number | null;
    nextAttemptAt: string | null;
  };
  activeAttemptId: string | null;
  attempts: {
    id: string;
    attemptNo: number;
    status: string;
    percent: number | null;
    passed: boolean | null;
    submittedAt: string | null;
    gradedAt: string | null;
  }[];
}

const STATUS_LABELS: Record<string, string> = {
  in_progress: 'не завершена',
  submitted: 'на оценке',
  graded: 'оценена',
  expired: 'время вышло',
  cancelled: 'аннулирована',
};

export function ExamScreen() {
  const { enrollmentId = '', examKey = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const exam = useQuery({
    queryKey: ['learning', 'exam', enrollmentId, examKey],
    queryFn: () => api.get<ExamDetails>(`/learning/enrollments/${enrollmentId}/exams/${examKey}`),
    retry: false,
  });

  const start = useMutation({
    mutationFn: () =>
      api.post<{ id: string }>(
        `/learning/enrollments/${enrollmentId}/exams/${examKey}/attempts`,
        undefined,
        { idempotencyKey: crypto.randomUUID() },
      ),
    onSuccess: async (attempt) => {
      await queryClient.invalidateQueries({ queryKey: ['learning'] });
      navigate(`/learning/${enrollmentId}/attempts/${attempt.id}`);
    },
    onError: async (e) =>
      alertDialog(e instanceof ApiError ? e.message : 'Не удалось начать попытку'),
  });

  if (exam.isLoading) return <SkeletonList rows={3} />;
  if (exam.isError) {
    const apiError = exam.error instanceof ApiError ? exam.error : null;
    if (apiError?.code === 'stage_locked' || apiError?.code === 'product_access_required') {
      return (
        <div className="pdr-stack">
          <Card>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Экзамен пока недоступен</div>
            <div className="pdr-hint">{apiError.message}</div>
          </Card>
          <Button variant="secondary" block onClick={() => navigate(`/learning/${enrollmentId}`)}>
            К карте курса
          </Button>
        </div>
      );
    }
    return <ErrorState message="Не удалось открыть экзамен" onRetry={() => exam.refetch()} />;
  }

  const data = exam.data!;

  return (
    <div className="pdr-stack">
      <div>
        <h1 className="pdr-title">{data.title}</h1>
        <div className="pdr-row">
          <Badge tone={data.kind === 'test' ? 'info' : 'warning'}>
            {data.kind === 'test' ? 'Тест' : 'Практический экзамен'}
          </Badge>
          {data.passed ? <Badge tone="success">Сдан</Badge> : null}
        </div>
      </div>

      {data.description ? (
        <Card>
          <div style={{ whiteSpace: 'pre-wrap' }}>{data.description}</div>
        </Card>
      ) : null}

      <Card>
        <div className="pdr-stack" style={{ gap: 6 }}>
          <div className="pdr-row">
            <span className="pdr-grow pdr-hint">Порог прохождения</span>
            <span style={{ fontWeight: 600 }}>{data.passingScore}%</span>
          </div>
          {data.questionsCount ? (
            <div className="pdr-row">
              <span className="pdr-grow pdr-hint">Вопросов</span>
              <span style={{ fontWeight: 600 }}>{data.questionsCount}</span>
            </div>
          ) : null}
          {data.timeLimitSec ? (
            <div className="pdr-row">
              <span className="pdr-grow pdr-hint">Время</span>
              <span style={{ fontWeight: 600 }}>
                {formatDuration(Math.round(data.timeLimitSec / 60))}
              </span>
            </div>
          ) : null}
          <div className="pdr-row">
            <span className="pdr-grow pdr-hint">Попытки</span>
            <span style={{ fontWeight: 600 }}>
              {data.maxAttempts
                ? `${data.availability.attemptsUsed} из ${data.maxAttempts}`
                : 'без ограничений'}
            </span>
          </div>
          {data.cooldownHours > 0 ? (
            <div className="pdr-row">
              <span className="pdr-grow pdr-hint">Пауза между попытками</span>
              <span style={{ fontWeight: 600 }}>
                {data.cooldownHours} {plural(data.cooldownHours, ['час', 'часа', 'часов'])}
              </span>
            </div>
          ) : null}
        </div>
      </Card>

      {data.kind === 'practical' ? (
        <Card>
          <div className="pdr-hint">
            Практический экзамен оценивает куратор. Приложите фотографии и видео работы, результат
            придёт в Telegram.
          </div>
        </Card>
      ) : null}

      {data.attempts.length > 0 ? (
        <>
          <h2 className="pdr-subtitle">Попытки</h2>
          <Card flat>
            <div className="pdr-list">
              {data.attempts.map((attempt) => (
                <ListItem
                  key={attempt.id}
                  title={`Попытка ${attempt.attemptNo}`}
                  subtitle={[
                    STATUS_LABELS[attempt.status] ?? attempt.status,
                    attempt.submittedAt ? formatDateTime(attempt.submittedAt) : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  right={
                    attempt.percent !== null ? (
                      <Badge tone={attempt.passed ? 'success' : 'danger'}>{attempt.percent}%</Badge>
                    ) : attempt.status === 'submitted' ? (
                      <Badge tone="info">ждёт оценки</Badge>
                    ) : null
                  }
                  onClick={
                    attempt.status === 'in_progress'
                      ? () => navigate(`/learning/${enrollmentId}/attempts/${attempt.id}`)
                      : () => navigate(`/learning/${enrollmentId}/attempts/${attempt.id}/result`)
                  }
                />
              ))}
            </div>
          </Card>
        </>
      ) : null}

      {data.activeAttemptId ? (
        <Button
          block
          onClick={() => navigate(`/learning/${enrollmentId}/attempts/${data.activeAttemptId}`)}
        >
          Продолжить попытку
        </Button>
      ) : data.availability.canStart ? (
        <Button
          block
          loading={start.isPending}
          onClick={async () => {
            const message =
              data.kind === 'test' && data.timeLimitSec
                ? `Начать попытку? На тест даётся ${formatDuration(Math.round(data.timeLimitSec / 60))}.`
                : 'Начать попытку?';
            if (await confirmDialog(message)) start.mutate();
          }}
        >
          {data.attempts.length === 0 ? 'Начать' : 'Пересдать'}
        </Button>
      ) : (
        <Card>
          <div className="pdr-hint">{data.availability.reason}</div>
        </Card>
      )}

      <Button
        variant="secondary"
        block
        onClick={() => navigate(`/learning/${enrollmentId}/stages/${data.stageKey}`)}
      >
        К этапу
      </Button>
    </div>
  );
}
