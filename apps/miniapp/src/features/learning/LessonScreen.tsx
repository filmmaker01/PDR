import { useCallback, useRef, useState } from 'react';
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
  // Сколько досмотрено в этом открытии: от этого зависит кнопка «Урок
  // пройден». Запрос урока после отправки прогресса не перечитывается, и без
  // этого кнопка оставалась неактивной до повторного открытия урока.
  const [watchedPercent, setWatchedPercent] = useState(0);
  const latest = useRef<{ positionSec: number; percent: number } | null>(null);

  const sendProgress = useCallback(
    (positionSec: number, percent: number, force = false) => {
      latest.current = { positionSec, percent };
      setWatchedPercent((current) => Math.max(current, Math.round(percent)));
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
    mutationFn: async () => {
      // Последняя позиция могла не уйти из-за паузы между отправками, а
      // сервер проверяет порог просмотра по своим данным: дошлём её сначала.
      if (latest.current) {
        await api.put(`/learning/enrollments/${enrollmentId}/lessons/${lessonKey}/progress`, {
          positionSec: Math.round(latest.current.positionSec),
          percent: Math.round(latest.current.percent),
        });
      }
      return api.post(`/learning/enrollments/${enrollmentId}/lessons/${lessonKey}/complete`);
    },
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
  const watched = Math.max(data.progress.watchPercent, watchedPercent);
  const canComplete = data.minWatchPercent === 0 || watched >= data.minWatchPercent;

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

      {data.video?.status === 'ready' ? (
        <VideoPlayer
          enrollmentId={enrollmentId}
          lessonKey={lessonKey}
          startAtSec={data.progress.watchPositionSec}
          durationSec={data.video.durationSec}
          onProgress={sendProgress}
        />
      ) : data.video ? (
        <Card>
          <div className="pdr-hint">
            {data.video.status === 'failed'
              ? 'Видео не удалось обработать. Мы уже знаем об этом.'
              : 'Видео ещё обрабатывается. Откройте урок чуть позже.'}
          </div>
        </Card>
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
          {canComplete ? 'Урок пройден' : `Посмотрите ещё ${data.minWatchPercent - watched}% урока`}
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
