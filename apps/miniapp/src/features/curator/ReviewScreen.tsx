import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@pdr/api-client';
import { Badge, Button, Card, Field, SkeletonList, Textarea } from '@pdr/ui';
import { api } from '@/shared/api';
import { formatDateTime } from '@/shared/format';
import { alertDialog, confirmDialog, haptic } from '@/shared/telegram';

interface ReviewSubmission {
  id: string;
  assignmentKey: string;
  attemptNo: number;
  status: string;
  text: string | null;
  submittedAt: string | null;
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

export function ReviewScreen() {
  const { submissionId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [comment, setComment] = useState('');
  const [question, setQuestion] = useState('');

  const key = ['curator', 'submission', submissionId];
  const submission = useQuery({
    queryKey: key,
    queryFn: () => api.get<ReviewSubmission>(`/curator/submissions/${submissionId}`),
    retry: false,
  });

  const claim = useMutation({
    mutationFn: () => api.post(`/curator/submissions/${submissionId}/claim`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
    onError: async (e) =>
      alertDialog(e instanceof ApiError ? e.message : 'Не удалось взять работу'),
  });

  const review = useMutation({
    mutationFn: (decision: 'accepted' | 'returned') =>
      api.post(`/curator/submissions/${submissionId}/review`, { decision, comment }),
    onSuccess: async () => {
      haptic('success');
      await queryClient.invalidateQueries({ queryKey: ['curator'] });
      navigate('/curator', { replace: true });
    },
    onError: async (e) => {
      haptic('error');
      await alertDialog(e instanceof ApiError ? e.message : 'Не удалось сохранить решение');
    },
  });

  const ask = useMutation({
    mutationFn: () => api.post(`/curator/submissions/${submissionId}/comments`, { body: question }),
    onSuccess: async () => {
      setQuestion('');
      await queryClient.invalidateQueries({ queryKey: key });
    },
  });

  if (submission.isLoading) return <SkeletonList rows={4} />;
  if (submission.isError) {
    return (
      <div className="pdr-stack">
        <Card>
          <div className="pdr-hint">
            {submission.error instanceof ApiError ? submission.error.message : 'Работа недоступна'}
          </div>
        </Card>
        <Button variant="secondary" block onClick={() => navigate('/curator')}>
          К очереди
        </Button>
      </div>
    );
  }

  const data = submission.data!;
  const decided = data.status === 'accepted' || data.status === 'returned';
  const heldByOther = data.claimedBy !== null && !data.claimedBy.isMe;

  return (
    <div className="pdr-stack">
      <div>
        <h1 className="pdr-title">{data.student.name}</h1>
        <div className="pdr-hint">
          Попытка {data.attemptNo} · {data.cohort.title}
          {data.submittedAt ? ` · отправлена ${formatDateTime(data.submittedAt)}` : ''}
        </div>
      </div>

      {heldByOther ? (
        <Card>
          <Badge tone="warning">Работу проверяет {data.claimedBy!.name}</Badge>
          <div className="pdr-hint" style={{ marginTop: 6 }}>
            Если он не завершит проверку за полчаса, работа вернётся в общую очередь.
          </div>
        </Card>
      ) : null}

      {data.files.length > 0 ? (
        <div className="pdr-stack" style={{ gap: 8 }}>
          {data.files.map((file) =>
            file.mimeType.startsWith('video/') ? (
              <video
                key={file.fileId}
                src={file.originalUrl ?? undefined}
                controls
                playsInline
                style={{ width: '100%', borderRadius: 12, background: '#000' }}
              />
            ) : (
              <a
                key={file.fileId}
                href={file.originalUrl ?? undefined}
                target="_blank"
                rel="noreferrer"
              >
                <img
                  src={file.previewUrl ?? file.originalUrl ?? undefined}
                  alt=""
                  style={{ width: '100%', borderRadius: 12, display: 'block' }}
                />
              </a>
            ),
          )}
        </div>
      ) : null}

      {data.text ? (
        <Card>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Комментарий ученика</div>
          <div style={{ whiteSpace: 'pre-wrap' }}>{data.text}</div>
        </Card>
      ) : null}

      {data.previousAttempts.length > 0 ? (
        <Card>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Предыдущие попытки</div>
          <div className="pdr-stack" style={{ gap: 8 }}>
            {data.previousAttempts.map((attempt) => (
              <div key={attempt.attemptNo}>
                <div className="pdr-hint">
                  Попытка {attempt.attemptNo} ·{' '}
                  {attempt.review?.decision === 'accepted' ? 'принята' : 'возвращена'}
                </div>
                {attempt.review ? <div>{attempt.review.comment}</div> : null}
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {data.comments.length > 0 ? (
        <Card>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Переписка</div>
          <div className="pdr-stack" style={{ gap: 8 }}>
            {data.comments.map((c) => (
              <div key={c.id}>
                <div className="pdr-hint">
                  {c.author}, {formatDateTime(c.createdAt)}
                </div>
                <div style={{ whiteSpace: 'pre-wrap' }}>{c.body}</div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {decided ? (
        <Card>
          <Badge tone={data.status === 'accepted' ? 'success' : 'warning'}>
            {data.status === 'accepted' ? 'Работа принята' : 'Работа возвращена'}
          </Badge>
        </Card>
      ) : (
        <>
          <Card>
            <div className="pdr-stack">
              <Field
                label="Комментарий"
                hint="Обязателен: ученик должен понять, что именно исправить или что получилось хорошо"
              >
                <Textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  rows={4}
                  placeholder="Свет поставлен неверно: полоса должна идти поперёк вмятины…"
                />
              </Field>
              <div className="pdr-row">
                <Button
                  className="pdr-grow"
                  disabled={comment.trim().length === 0 || heldByOther}
                  loading={review.isPending}
                  onClick={async () => {
                    if (await confirmDialog('Принять работу?')) review.mutate('accepted');
                  }}
                >
                  Принять
                </Button>
                <Button
                  className="pdr-grow"
                  variant="secondary"
                  disabled={comment.trim().length === 0 || heldByOther}
                  loading={review.isPending}
                  onClick={() => review.mutate('returned')}
                >
                  На доработку
                </Button>
              </div>
              {!data.claimedBy ? (
                <Button variant="ghost" block onClick={() => claim.mutate()}>
                  Взять на проверку (чтобы не пересеклись)
                </Button>
              ) : null}
            </div>
          </Card>

          <Card>
            <div className="pdr-stack">
              <Field label="Уточняющий вопрос" hint="Не меняет статус работы">
                <Textarea
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  rows={2}
                  placeholder="С какого расстояния снимали «до»?"
                />
              </Field>
              <Button
                variant="secondary"
                block
                disabled={question.trim().length === 0}
                loading={ask.isPending}
                onClick={() => ask.mutate()}
              >
                Отправить вопрос
              </Button>
            </div>
          </Card>
        </>
      )}

      <Button variant="secondary" block onClick={() => navigate('/curator')}>
        К очереди
      </Button>
    </div>
  );
}
