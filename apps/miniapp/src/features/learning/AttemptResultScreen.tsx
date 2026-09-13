import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button, Card, SkeletonList } from '@pdr/ui';
import { api } from '@/shared/api';

interface ResultQuestion {
  id: string;
  kind: string;
  body: string;
  points: number;
  options: { id: string; body: string; isCorrect?: boolean }[];
  answer: {
    selectedOptionIds: string[];
    textAnswer: string | null;
    isCorrect?: boolean | null;
    pointsAwarded?: number | null;
  } | null;
  explanation?: string | null;
}

interface AttemptResult {
  id: string;
  examKey: string;
  kind: 'test' | 'practical';
  status: string;
  attemptNo: number;
  score: number | null;
  maxScore: number | null;
  percent: number | null;
  passed: boolean | null;
  passingScore: number;
  graderComment: string | null;
  availability: { canStart: boolean; reason: string | null };
  questions: ResultQuestion[];
  files: { fileId: string; thumbUrl: string | null }[];
}

export function AttemptResultScreen() {
  const { enrollmentId = '', attemptId = '' } = useParams();
  const navigate = useNavigate();

  const result = useQuery({
    queryKey: ['learning', 'attempt-result', attemptId],
    queryFn: () => api.get<AttemptResult>(`/learning/attempts/${attemptId}/result`),
  });

  if (result.isLoading) return <SkeletonList rows={3} />;
  const data = result.data!;

  const waiting = data.status === 'submitted';

  return (
    <div className="pdr-stack">
      <h1 className="pdr-title">Результат</h1>

      <Card>
        {waiting ? (
          <div>
            <Badge tone="info">Ждёт оценки куратора</Badge>
            <div className="pdr-hint" style={{ marginTop: 6 }}>
              Результат придёт в Telegram, как только куратор проверит работу.
            </div>
          </div>
        ) : (
          <div className="pdr-stack" style={{ gap: 8 }}>
            <div className="pdr-row">
              <span className="pdr-grow" style={{ fontSize: 28, fontWeight: 700 }}>
                {data.percent ?? 0}%
              </span>
              <Badge tone={data.passed ? 'success' : 'danger'}>
                {data.passed ? 'Сдано' : 'Не сдано'}
              </Badge>
            </div>
            <div className="pdr-hint">
              Порог: {data.passingScore}%
              {data.maxScore ? ` · баллов ${data.score} из ${data.maxScore}` : ''}
              {data.status === 'expired' ? ' · время вышло' : ''}
            </div>
            {!data.passed && data.availability.reason ? (
              <div className="pdr-hint">{data.availability.reason}</div>
            ) : null}
          </div>
        )}
      </Card>

      {data.graderComment ? (
        <Card>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Комментарий куратора</div>
          <div style={{ whiteSpace: 'pre-wrap' }}>{data.graderComment}</div>
        </Card>
      ) : null}

      {data.kind === 'test' && data.questions.length > 0 && !waiting ? (
        <>
          <h2 className="pdr-subtitle">Разбор</h2>
          {data.questions.map((question, index) => {
            const correct = question.answer?.isCorrect === true;
            return (
              <Card key={question.id}>
                <div className="pdr-row" style={{ marginBottom: 8 }}>
                  <span className="pdr-grow" style={{ fontWeight: 600 }}>
                    {index + 1}. {question.body}
                  </span>
                  <Badge tone={correct ? 'success' : 'danger'}>
                    {correct ? 'верно' : 'неверно'}
                  </Badge>
                </div>

                {question.kind === 'short_text' ? (
                  <div className="pdr-hint">Ваш ответ: {question.answer?.textAnswer ?? '—'}</div>
                ) : (
                  <div className="pdr-stack" style={{ gap: 4 }}>
                    {question.options.map((option) => {
                      const chosen =
                        question.answer?.selectedOptionIds.includes(option.id) ?? false;
                      const isRight = option.isCorrect === true;
                      return (
                        <div
                          key={option.id}
                          style={{
                            color: isRight
                              ? 'var(--pdr-success)'
                              : chosen
                                ? 'var(--pdr-destructive)'
                                : 'var(--pdr-hint)',
                          }}
                        >
                          {isRight ? '✓' : chosen ? '✗' : '·'} {option.body}
                        </div>
                      );
                    })}
                  </div>
                )}

                {question.explanation ? (
                  <div className="pdr-hint" style={{ marginTop: 8 }}>
                    {question.explanation}
                  </div>
                ) : null}
              </Card>
            );
          })}
        </>
      ) : null}

      {data.files.length > 0 ? (
        <Card>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Приложенные материалы</div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))',
              gap: 6,
            }}
          >
            {data.files.map((file) =>
              file.thumbUrl ? (
                <img
                  key={file.fileId}
                  src={file.thumbUrl}
                  alt=""
                  style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 8 }}
                />
              ) : (
                <div key={file.fileId} className="pdr-skeleton" style={{ aspectRatio: '1' }} />
              ),
            )}
          </div>
        </Card>
      ) : null}

      <Button block onClick={() => navigate(`/learning/${enrollmentId}/exams/${data.examKey}`)}>
        К экзамену
      </Button>
      <Button variant="secondary" block onClick={() => navigate(`/learning/${enrollmentId}`)}>
        К карте курса
      </Button>
    </div>
  );
}
