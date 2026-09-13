import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Badge, Card, Chips, EmptyState, ErrorState, ListItem, SkeletonList } from '@pdr/ui';
import { api } from '@/shared/api';
import { plural } from '@/shared/format';

interface QueueItem {
  id: string;
  assignmentTitle: string;
  attemptNo: number;
  status: string;
  waitingHours: number;
  filesCount: number;
  student: { name: string; username: string | null };
  cohort: { id: string; title: string };
  claimedBy: { id: string; name: string; isMe: boolean } | null;
}

interface CuratorCohort {
  id: string;
  title: string;
  courseTitle: string;
  studentsCount: number;
  pendingReviews: number;
}

/** Очередь проверок с телефона: куратор часто смотрит работы не за компьютером. */
export function ReviewQueueScreen() {
  const navigate = useNavigate();
  const [cohortId, setCohortId] = useState<string | null>(null);

  const cohorts = useQuery({
    queryKey: ['curator', 'cohorts'],
    queryFn: () => api.get<CuratorCohort[]>('/curator/cohorts'),
  });

  const queue = useQuery({
    queryKey: ['curator', 'queue', cohortId],
    queryFn: () =>
      api.get<QueueItem[]>('/curator/review-queue', {
        query: { cohortId: cohortId ?? undefined, limit: 100 },
      }),
  });

  if (queue.isLoading) return <SkeletonList rows={4} />;
  if (queue.isError) {
    return <ErrorState message="Не удалось загрузить очередь" onRetry={() => queue.refetch()} />;
  }

  const items = queue.data ?? [];
  const total = (cohorts.data ?? []).reduce((sum, c) => sum + c.pendingReviews, 0);

  return (
    <div className="pdr-stack">
      <div>
        <h1 className="pdr-title">Очередь проверок</h1>
        <div className="pdr-hint">
          {total} {plural(total, ['работа ждёт', 'работы ждут', 'работ ждут'])} проверки
        </div>
      </div>

      {(cohorts.data ?? []).length > 1 ? (
        <Chips
          options={(cohorts.data ?? []).map((c) => ({
            value: c.id,
            label: `${c.title} (${c.pendingReviews})`,
          }))}
          value={cohortId}
          onChange={setCohortId}
        />
      ) : null}

      {items.length === 0 ? (
        <EmptyState
          title="Очередь пуста"
          description="Все работы проверены. Новые появятся здесь автоматически."
        />
      ) : (
        <Card flat>
          <div className="pdr-list">
            {items.map((item) => (
              <ListItem
                key={item.id}
                title={`${item.student.name} — ${item.assignmentTitle}`}
                subtitle={[
                  `попытка ${item.attemptNo}`,
                  item.filesCount > 0 ? `файлов: ${item.filesCount}` : null,
                  item.waitingHours > 0
                    ? `ждёт ${item.waitingHours} ${plural(item.waitingHours, ['час', 'часа', 'часов'])}`
                    : 'только что',
                  item.cohort.title,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                right={
                  item.claimedBy ? (
                    <Badge tone={item.claimedBy.isMe ? 'info' : 'warning'}>
                      {item.claimedBy.isMe ? 'у вас' : item.claimedBy.name}
                    </Badge>
                  ) : item.waitingHours >= 48 ? (
                    <Badge tone="danger">давно</Badge>
                  ) : null
                }
                onClick={() => navigate(`/curator/submissions/${item.id}`)}
              />
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
