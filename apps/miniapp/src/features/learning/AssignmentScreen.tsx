import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@pdr/api-client';
import { Badge, Button, Card, EmptyState, ErrorState, SkeletonList } from '@pdr/ui';
import { api } from '@/shared/api';
import { formatDateTime } from '@/shared/format';
import { alertDialog } from '@/shared/telegram';

interface AttemptFile {
  fileId: string;
  mimeType: string;
  status: string;
  thumbUrl: string | null;
}

interface Attempt {
  id: string;
  attemptNo: number;
  status: 'draft' | 'submitted' | 'in_review' | 'accepted' | 'returned';
  text: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  files: AttemptFile[];
  review: {
    decision: 'accepted' | 'returned';
    comment: string;
    createdAt: string;
    reviewer: string;
  } | null;
}

interface AssignmentDetails {
  key: string;
  stageKey: string;
  title: string;
  instructions: string;
  isRequired: boolean;
  requiredMedia: { min_photos?: number; min_videos?: number; text_required?: boolean };
  maxVideoSec: number | null;
  accepted: boolean;
  activeSubmissionId: string | null;
  attempts: Attempt[];
}

const STATUS_LABELS: Record<
  Attempt['status'],
  { label: string; tone: 'success' | 'warning' | 'info' | 'muted' }
> = {
  draft: { label: 'Черновик', tone: 'muted' },
  submitted: { label: 'На проверке', tone: 'info' },
  in_review: { label: 'Проверяется', tone: 'info' },
  accepted: { label: 'Принята', tone: 'success' },
  returned: { label: 'На доработке', tone: 'warning' },
};

export function AssignmentScreen() {
  const { enrollmentId = '', assignmentKey = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  const assignment = useQuery({
    queryKey: ['learning', 'assignment', enrollmentId, assignmentKey],
    queryFn: () =>
      api.get<AssignmentDetails>(
        `/learning/enrollments/${enrollmentId}/assignments/${assignmentKey}`,
      ),
    retry: false,
  });

  const startAttempt = useMutation({
    mutationFn: () =>
      api.post<{ submissionId: string }>(
        `/learning/enrollments/${enrollmentId}/assignments/${assignmentKey}/submissions`,
      ),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['learning'] });
      navigate(`/learning/${enrollmentId}/submissions/${result.submissionId}/edit`);
    },
    onError: async (e) => {
      await alertDialog(e instanceof ApiError ? e.message : 'Не удалось начать работу');
    },
  });

  if (assignment.isLoading) return <SkeletonList rows={3} />;
  if (assignment.isError) {
    const apiError = assignment.error instanceof ApiError ? assignment.error : null;
    if (apiError?.code === 'stage_locked' || apiError?.code === 'product_access_required') {
      return (
        <div className="pdr-stack">
          <Card>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Задание пока недоступно</div>
            <div className="pdr-hint">{apiError.message}</div>
          </Card>
          <Button variant="secondary" block onClick={() => navigate(`/learning/${enrollmentId}`)}>
            К карте курса
          </Button>
        </div>
      );
    }
    return <ErrorState message="Не удалось открыть задание" onRetry={() => assignment.refetch()} />;
  }

  const data = assignment.data!;
  const active = data.attempts.find((a) => a.id === data.activeSubmissionId);
  const canStart = !data.accepted && (!active || active.status === 'draft');
  const waiting = active && (active.status === 'submitted' || active.status === 'in_review');

  const requirements = [
    data.requiredMedia.min_photos ? `фото: не менее ${data.requiredMedia.min_photos}` : null,
    data.requiredMedia.min_videos ? `видео: не менее ${data.requiredMedia.min_videos}` : null,
    data.requiredMedia.text_required ? 'описание работы' : null,
  ].filter(Boolean);

  return (
    <div className="pdr-stack">
      <div>
        <h1 className="pdr-title">{data.title}</h1>
        <div className="pdr-row">
          {data.accepted ? (
            <Badge tone="success">Работа принята</Badge>
          ) : waiting ? (
            <Badge tone="info">На проверке</Badge>
          ) : data.isRequired ? (
            <Badge tone="muted">Обязательная работа</Badge>
          ) : (
            <Badge tone="muted">По желанию</Badge>
          )}
        </div>
      </div>

      <Card>
        <div style={{ whiteSpace: 'pre-wrap' }}>{data.instructions}</div>
        {requirements.length > 0 ? (
          <div className="pdr-hint" style={{ marginTop: 10 }}>
            Нужно приложить: {requirements.join(', ')}
          </div>
        ) : null}
      </Card>

      {waiting ? (
        <Card>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Работа отправлена</div>
          <div className="pdr-hint">
            Куратор проверит её и пришлёт ответ в Telegram. Пока идёт проверка, отправить новую
            версию нельзя.
          </div>
        </Card>
      ) : null}

      {data.attempts.length === 0 ? (
        <EmptyState title="Вы ещё не сдавали эту работу" />
      ) : (
        <>
          <h2 className="pdr-subtitle">История сдач</h2>
          {data.attempts.map((attempt) => {
            const status = STATUS_LABELS[attempt.status];
            return (
              <Card key={attempt.id}>
                <div className="pdr-row" style={{ marginBottom: 6 }}>
                  <span className="pdr-grow" style={{ fontWeight: 600 }}>
                    Попытка {attempt.attemptNo}
                  </span>
                  <Badge tone={status.tone}>{status.label}</Badge>
                </div>

                {attempt.submittedAt ? (
                  <div className="pdr-hint">Отправлена {formatDateTime(attempt.submittedAt)}</div>
                ) : null}

                {attempt.files.length > 0 ? (
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))',
                      gap: 6,
                      margin: '8px 0',
                    }}
                  >
                    {attempt.files.map((file) =>
                      file.thumbUrl ? (
                        <img
                          key={file.fileId}
                          src={file.thumbUrl}
                          alt=""
                          style={{
                            width: '100%',
                            aspectRatio: '1',
                            objectFit: 'cover',
                            borderRadius: 8,
                          }}
                        />
                      ) : (
                        <div
                          key={file.fileId}
                          className="pdr-skeleton"
                          style={{ aspectRatio: '1' }}
                        />
                      ),
                    )}
                  </div>
                ) : null}

                {attempt.text ? (
                  <div className="pdr-hint" style={{ whiteSpace: 'pre-wrap' }}>
                    {attempt.text}
                  </div>
                ) : null}

                {attempt.review ? (
                  <div
                    style={{
                      marginTop: 10,
                      paddingTop: 10,
                      borderTop: '1px solid var(--pdr-separator)',
                    }}
                  >
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>
                      {attempt.review.decision === 'accepted'
                        ? 'Принято'
                        : 'Возвращено на доработку'}
                    </div>
                    <div style={{ whiteSpace: 'pre-wrap' }}>{attempt.review.comment}</div>
                    <div className="pdr-hint" style={{ marginTop: 4 }}>
                      {attempt.review.reviewer}, {formatDateTime(attempt.review.createdAt)}
                    </div>
                  </div>
                ) : null}

                {attempt.status === 'draft' ? (
                  <Button
                    variant="secondary"
                    block
                    style={{ marginTop: 10 }}
                    onClick={() =>
                      navigate(`/learning/${enrollmentId}/submissions/${attempt.id}/edit`)
                    }
                  >
                    Продолжить заполнение
                  </Button>
                ) : null}
              </Card>
            );
          })}
        </>
      )}

      {canStart ? (
        <Button
          block
          loading={startAttempt.isPending || busy}
          onClick={() => {
            setBusy(true);
            startAttempt.mutate(undefined, { onSettled: () => setBusy(false) });
          }}
        >
          {data.attempts.length === 0 ? 'Сдать работу' : 'Сдать заново'}
        </Button>
      ) : null}

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
