import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Badge, Card, EmptyState, ErrorState, ListItem, SkeletonList } from '@pdr/ui';
import { api } from '@/shared/api';
import { formatDuration } from '@/shared/format';
import type { StageDetails } from './types';

export function StageScreen() {
  const { enrollmentId = '', stageKey = '' } = useParams();
  const navigate = useNavigate();

  const stage = useQuery({
    queryKey: ['learning', 'stage', enrollmentId, stageKey],
    queryFn: () =>
      api.get<StageDetails>(`/learning/enrollments/${enrollmentId}/stages/${stageKey}`),
  });

  if (stage.isLoading) return <SkeletonList rows={4} />;
  if (stage.isError) {
    return <ErrorState message="Не удалось загрузить этап" onRetry={() => stage.refetch()} />;
  }

  const data = stage.data!;
  const locked = data.access.status === 'locked';

  return (
    <div className="pdr-stack">
      <div>
        <h1 className="pdr-title">{data.title}</h1>
        {data.description ? <div className="pdr-hint">{data.description}</div> : null}
      </div>

      {locked && data.access.status === 'locked' ? (
        <Card>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Этап пока закрыт</div>
          <div className="pdr-stack" style={{ gap: 4 }}>
            {data.access.reasons.map((reason) => (
              <div key={reason.code}>• {reason.message}</div>
            ))}
          </div>
        </Card>
      ) : (
        <>
          {data.lessons.length > 0 ? (
            <Card flat>
              <div className="pdr-list">
                {data.lessons.map((lesson, index) => (
                  <ListItem
                    key={lesson.key}
                    title={`${index + 1}. ${lesson.title}`}
                    subtitle={[
                      lesson.estimatedMinutes ? formatDuration(lesson.estimatedMinutes) : null,
                      lesson.materialsCount > 0 ? `материалов: ${lesson.materialsCount}` : null,
                      !lesson.isRequired ? 'необязательный' : null,
                      lesson.progress.watchPercent > 0 && !lesson.progress.completed
                        ? `просмотрено ${lesson.progress.watchPercent}%`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                    right={lesson.progress.completed ? <Badge tone="success">✓</Badge> : null}
                    onClick={() => navigate(`/learning/${enrollmentId}/lessons/${lesson.key}`)}
                  />
                ))}
              </div>
            </Card>
          ) : (
            <EmptyState title="В этапе пока нет уроков" />
          )}

          {data.assignments.length > 0 ? (
            <>
              <h2 className="pdr-subtitle">Практика</h2>
              <Card flat>
                <div className="pdr-list">
                  {data.assignments.map((assignment) => (
                    <ListItem
                      key={assignment.key}
                      title={assignment.title}
                      subtitle={assignment.isRequired ? 'обязательная работа' : 'по желанию'}
                      right={
                        assignment.accepted ? (
                          <Badge tone="success">Принята</Badge>
                        ) : (
                          <Badge tone="muted">Не сдана</Badge>
                        )
                      }
                      onClick={() =>
                        navigate(`/learning/${enrollmentId}/assignments/${assignment.key}`)
                      }
                    />
                  ))}
                </div>
              </Card>
            </>
          ) : null}

          {data.exams.length > 0 ? (
            <>
              <h2 className="pdr-subtitle">Экзамены</h2>
              <Card flat>
                <div className="pdr-list">
                  {data.exams.map((exam) => (
                    <ListItem
                      key={exam.key}
                      title={exam.title}
                      subtitle={`${exam.kind === 'test' ? 'тест' : 'практический'} · порог ${exam.passingScore}%`}
                      right={
                        exam.passed ? (
                          <Badge tone="success">Сдан</Badge>
                        ) : (
                          <Badge tone="muted">Не сдан</Badge>
                        )
                      }
                      onClick={() => navigate(`/learning/${enrollmentId}/exams/${exam.key}`)}
                    />
                  ))}
                </div>
              </Card>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
