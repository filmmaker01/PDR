import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Badge, Card, EmptyState, ErrorState, SkeletonList } from '@pdr/ui';
import { api } from '@/shared/api';
import { useMe } from '@/features/auth/AuthProvider';
import type { CourseMap, EnrollmentSummary } from './types';
import { StageCard } from './StageCard';

/** Если зачисление одно — открываем сразу, иначе показываем выбор. */
export function LearningEntryScreen() {
  const me = useMe();
  const navigate = useNavigate();

  const enrollments = useQuery({
    queryKey: ['learning', 'enrollments'],
    queryFn: () => api.get<EnrollmentSummary[]>('/learning/enrollments'),
  });

  if (enrollments.isLoading) return <SkeletonList rows={3} />;
  if (enrollments.isError) {
    return (
      <ErrorState message="Не удалось загрузить курсы" onRetry={() => enrollments.refetch()} />
    );
  }

  const list = enrollments.data ?? [];

  if (list.length === 0) {
    return (
      <div className="pdr-stack">
        <h1 className="pdr-title">Обучение</h1>
        <EmptyState
          title="У вас пока нет доступа к курсу"
          description={
            me.platformRoles.length > 0
              ? 'Доступ выдаётся администратором вместе с зачислением в группу.'
              : 'Доступ к курсу открывает администратор после оплаты. Напишите ему, если уже оплатили.'
          }
        />
      </div>
    );
  }

  if (list.length === 1) {
    return <CourseMapScreen enrollmentId={list[0]!.id} />;
  }

  return (
    <div className="pdr-stack">
      <h1 className="pdr-title">Мои курсы</h1>
      {list.map((enrollment) => (
        <Card key={enrollment.id}>
          <button
            type="button"
            style={{ all: 'unset', cursor: 'pointer', display: 'block', width: '100%' }}
            onClick={() => navigate(`/learning/${enrollment.id}`)}
          >
            <div style={{ fontWeight: 600 }}>{enrollment.courseTitle}</div>
            <div className="pdr-hint">
              {enrollment.cohortTitle} · этапов пройдено {enrollment.stagesDone} из{' '}
              {enrollment.stagesTotal}
            </div>
            {!enrollment.hasActiveAccess ? <Badge tone="danger">Доступ завершён</Badge> : null}
          </button>
        </Card>
      ))}
    </div>
  );
}

export function CourseMapRoute() {
  const { enrollmentId = '' } = useParams();
  return <CourseMapScreen enrollmentId={enrollmentId} />;
}

function CourseMapScreen({ enrollmentId }: { enrollmentId: string }) {
  const navigate = useNavigate();
  const map = useQuery({
    queryKey: ['learning', 'map', enrollmentId],
    queryFn: () => api.get<CourseMap>(`/learning/enrollments/${enrollmentId}`),
  });

  if (map.isLoading) return <SkeletonList rows={4} />;
  if (map.isError) {
    return <ErrorState message="Не удалось загрузить курс" onRetry={() => map.refetch()} />;
  }

  const data = map.data!;
  const expiring =
    data.access.validUntil &&
    new Date(data.access.validUntil).getTime() - Date.now() < 14 * 86_400_000;

  return (
    <div className="pdr-stack">
      <div>
        <h1 className="pdr-title">{data.courseTitle}</h1>
        <div className="pdr-hint">{data.cohortTitle}</div>
      </div>

      {!data.access.active ? (
        <Card>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Доступ к курсу завершён</div>
          <div className="pdr-hint">
            Прогресс сохранён полностью. После продления обучение продолжится с того же места.
          </div>
        </Card>
      ) : expiring ? (
        <Card>
          <div className="pdr-hint">
            Доступ действует до{' '}
            {new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(
              new Date(data.access.validUntil!),
            )}
            .
          </div>
        </Card>
      ) : null}

      <Card>
        <div className="pdr-row">
          <div className="pdr-grow">
            <div style={{ fontWeight: 600 }}>
              Этапов пройдено: {data.overall.stages.done} из {data.overall.stages.total}
            </div>
            <div className="pdr-hint">
              Уроков: {data.overall.lessons.done} из {data.overall.lessons.total}
            </div>
          </div>
          <Badge tone={data.status === 'completed' ? 'success' : 'info'}>
            {data.status === 'completed' ? 'Курс пройден' : 'В процессе'}
          </Badge>
        </div>
      </Card>

      {data.stages.map((stage, index) => (
        <StageCard
          key={stage.key}
          index={index + 1}
          stage={stage}
          onOpen={() => navigate(`/learning/${enrollmentId}/stages/${stage.key}`)}
        />
      ))}
    </div>
  );
}
