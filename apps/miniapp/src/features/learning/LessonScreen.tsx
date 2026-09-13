import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@pdr/api-client';
import { Badge, Button, Card, ErrorState, ListItem, SkeletonList } from '@pdr/ui';
import { api } from '@/shared/api';
import { formatDuration } from '@/shared/format';
import { alertDialog, haptic } from '@/shared/telegram';
import type { LessonDetails } from './types';
import { VideoPlayer } from './VideoPlayer';

/** Позиция отправляется не чаще раза в 10 секунд: чаще не нужно и разряжает связь. */
const PROGRESS_INTERVAL_MS = 10_000;

export function LessonScreen() {
  const { enrollmentId = '', lessonKey = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const lesson = useQuery({
    queryKey: ['learning', 'lesson', enrollmentId, lessonKey],
    queryFn: () =>
      api.get<LessonDetails>(`/learning/enrollments/${enrollmentId}/lessons/${lessonKey}`),
    retry: false,
  });

  const lastSent = useRef({ at: 0, percent: 0 });

  const sendProgress = useCallback(
    (positionSec: number, percent: number, force = false) => {
      const now = Date.now();
      if (!force && now - lastSent.current.at < PROGRESS_INTERVAL_MS) return;
      lastSent.current = { at: now, percent };

      // Потеря одной отправки не критична: позиция дошлётся при паузе и уходе.
      void api
        .put(`/learning/enrollments/${enrollmentId}/lessons/${lessonKey}/progress`, {
          positionSec: Math.round(positionSec),
          percent: Math.round(percent),
        })
        .catch(() => undefined);
    },
    [enrollmentId, lessonKey],
  );

  const complete = useMutation({
    mutationFn: () =>
      api.post(`/learning/enrollments/${enrollmentId}/lessons/${lessonKey}/complete`),
    onSuccess: async () => {
      haptic('success');
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ['learning'] });
    },
    onError: async (e) => {
      haptic('error');
      const message = e instanceof ApiError ? e.message : 'Не удалось отметить урок';
      setError(message);
      await alertDialog(message);
    },
  });

  useEffect(() => {
    return () => {
      // Уход с экрана: досылаем последнюю позицию.
      const player = document.querySelector('video');
      if (player && player.duration > 0) {
        sendProgress(player.currentTime, (player.currentTime / player.duration) * 100, true);
      }
    };
  }, [sendProgress]);

  if (lesson.isLoading) return <SkeletonList rows={3} />;

  if (lesson.isError) {
    const apiError = lesson.error instanceof ApiError ? lesson.error : null;
    if (apiError?.code === 'stage_locked' || apiError?.code === 'product_access_required') {
      return (
        <div className="pdr-stack">
          <Card>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Урок пока недоступен</div>
            <div className="pdr-hint">{apiError.message}</div>
          </Card>
          <Button variant="secondary" block onClick={() => navigate(`/learning/${enrollmentId}`)}>
            К карте курса
          </Button>
        </div>
      );
    }
    return <ErrorState message="Не удалось открыть урок" onRetry={() => lesson.refetch()} />;
  }

  const data = lesson.data!;
  const canComplete =
    data.minWatchPercent === 0 || data.progress.watchPercent >= data.minWatchPercent;

  return (
    <div className="pdr-stack">
      <div>
        <h1 className="pdr-title">{data.title}</h1>
        <div className="pdr-hint">
          {[
            data.estimatedMinutes ? formatDuration(data.estimatedMinutes) : null,
            data.isRequired ? 'обязательный урок' : 'необязательный урок',
          ]
            .filter(Boolean)
            .join(' · ')}
        </div>
      </div>

      {data.video ? (
        <VideoPlayer
          video={data.video}
          startAtSec={data.progress.watchPositionSec}
          onProgress={sendProgress}
        />
      ) : (
        <Card>
          <div className="pdr-hint">К этому уроку видео не приложено.</div>
        </Card>
      )}

      {data.description ? (
        <Card>
          <div style={{ whiteSpace: 'pre-wrap' }}>{data.description}</div>
        </Card>
      ) : null}

      {data.materials.length > 0 ? (
        <>
          <h2 className="pdr-subtitle">Материалы</h2>
          <Card flat>
            <div className="pdr-list">
              {data.materials.map((material) => (
                <MaterialItem
                  key={material.id}
                  enrollmentId={enrollmentId}
                  lessonKey={lessonKey}
                  material={material}
                />
              ))}
            </div>
          </Card>
        </>
      ) : null}

      {data.assignments.length > 0 ? (
        <>
          <h2 className="pdr-subtitle">Задание к уроку</h2>
          <Card flat>
            <div className="pdr-list">
              {data.assignments.map((assignment) => (
                <ListItem
                  key={assignment.key}
                  title={assignment.title}
                  onClick={() =>
                    navigate(`/learning/${enrollmentId}/assignments/${assignment.key}`)
                  }
                />
              ))}
            </div>
          </Card>
        </>
      ) : null}

      {error ? (
        <Card>
          <span style={{ color: 'var(--pdr-destructive)' }}>{error}</span>
        </Card>
      ) : null}

      {data.progress.completed ? (
        <Card>
          <div className="pdr-row">
            <Badge tone="success">Урок пройден</Badge>
          </div>
        </Card>
      ) : (
        <Button
          block
          disabled={!canComplete}
          loading={complete.isPending}
          onClick={() => complete.mutate()}
        >
          {canComplete
            ? 'Урок пройден'
            : `Посмотрите ещё ${data.minWatchPercent - data.progress.watchPercent}% урока`}
        </Button>
      )}

      <div className="pdr-row">
        {data.navigation.previousKey ? (
          <Button
            variant="secondary"
            onClick={() =>
              navigate(`/learning/${enrollmentId}/lessons/${data.navigation.previousKey}`)
            }
          >
            ← Предыдущий
          </Button>
        ) : null}
        <span className="pdr-grow" />
        {data.navigation.nextKey ? (
          <Button
            variant="secondary"
            onClick={() => navigate(`/learning/${enrollmentId}/lessons/${data.navigation.nextKey}`)}
          >
            Следующий →
          </Button>
        ) : (
          <Button
            variant="secondary"
            onClick={() => navigate(`/learning/${enrollmentId}/stages/${data.stageKey}`)}
          >
            К этапу
          </Button>
        )}
      </div>
    </div>
  );
}

function MaterialItem({
  enrollmentId,
  lessonKey,
  material,
}: {
  enrollmentId: string;
  lessonKey: string;
  material: LessonDetails['materials'][number];
}) {
  const [loading, setLoading] = useState(false);

  const open = async (): Promise<void> => {
    if (material.kind === 'link' && material.url) {
      window.open(material.url, '_blank');
      return;
    }
    if (material.kind === 'file' && material.fileId) {
      setLoading(true);
      try {
        const result = await api.get<{ url: string }>(
          `/learning/enrollments/${enrollmentId}/lessons/${lessonKey}/materials/${material.id}/download`,
        );
        window.open(result.url, '_blank');
      } catch (e) {
        await alertDialog(e instanceof ApiError ? e.message : 'Не удалось открыть материал');
      } finally {
        setLoading(false);
      }
    }
  };

  if (material.kind === 'text') {
    return (
      <div className="pdr-list__item pdr-list__item--static">
        <span className="pdr-grow">
          <span style={{ display: 'block', fontWeight: 500 }}>{material.title}</span>
          <span className="pdr-hint" style={{ whiteSpace: 'pre-wrap' }}>
            {material.body}
          </span>
        </span>
      </div>
    );
  }

  return (
    <ListItem
      title={material.title}
      subtitle={material.kind === 'link' ? 'ссылка' : 'файл'}
      right={loading ? <span className="pdr-spinner" /> : null}
      onClick={() => void open()}
    />
  );
}
