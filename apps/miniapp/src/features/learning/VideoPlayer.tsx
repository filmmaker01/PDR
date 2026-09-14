import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Card, Spinner } from '@pdr/ui';
import { ApiError } from '@pdr/api-client';
import { api } from '@/shared/api';
import type { PlaybackSession } from './types';
import { createPlayer, type PlayerHandle } from './playback/playerBridge';
import {
  NO_CAPABILITIES,
  describeCapabilities,
  detectCapabilities,
  type PlaybackCapabilities,
} from './playback/capabilities';

interface Props {
  enrollmentId: string;
  lessonKey: string;
  startAtSec: number;
  durationSec: number | null;
  onProgress: (positionSec: number, percent: number, force?: boolean) => void;
}

/**
 * Плеер урока.
 *
 * Видео не воспроизводится напрямую: клиент запрашивает у сервера сессию
 * просмотра, и только она даёт плееру право показать ролик. Никакой ссылки на
 * поток приложение не получает и получить не может, поэтому и скачивать
 * нечего — нативного элемента video здесь нет.
 *
 * Сессия живёт минуты: когда она заканчивается, плеер пересоздаётся с новой.
 */
export function VideoPlayer({
  enrollmentId,
  lessonKey,
  startAtSec,
  durationSec,
  onProgress,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<PlayerHandle | null>(null);
  const [session, setSession] = useState<PlaybackSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Позиция переживает пересоздание плеера: продление сессии не должно
  // отбрасывать ученика в начало урока. Досмотренный до конца урок при этом
  // открывается сначала, а не упирается в последний кадр.
  const positionRef = useRef(durationSec && startAtSec >= durationSec - 5 ? 0 : startAtSec);
  // Если защищённое воспроизведение не пошло, второй раз его не просим.
  const drmFailedRef = useRef(false);

  const requestSession = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const capabilities: PlaybackCapabilities = drmFailedRef.current
        ? NO_CAPABILITIES
        : await detectCapabilities();

      const issued = await api.post<PlaybackSession>(
        `/learning/enrollments/${enrollmentId}/lessons/${lessonKey}/playback`,
        { capabilities },
      );
      // Возможности клиента и выданный режим пишутся в консоль: когда в
      // Telegram WebView защищённое воспроизведение не заведётся, из логов
      // сразу видно, что именно умел клиент и что ему выдали.
      console.warn('[video] режим просмотра', {
        drm: issued.drm,
        capabilities: describeCapabilities(capabilities),
        sessionId: issued.sessionId,
      });
      setSession(issued);
    } catch (e) {
      const message = e instanceof ApiError ? e.message : 'Не удалось получить доступ к просмотру';
      setError(message);
      setSession(null);
    } finally {
      setLoading(false);
    }
  }, [enrollmentId, lessonKey]);

  useEffect(() => {
    void requestSession();
  }, [requestSession]);

  // Продление до истечения: иначе плеер замолчит посреди урока.
  useEffect(() => {
    if (!session) return;
    const leftMs = new Date(session.expiresAt).getTime() - Date.now();
    const renewIn = Math.max(5_000, leftMs - 30_000);
    const timer = window.setTimeout(() => void requestSession(), renewIn);
    return () => window.clearTimeout(timer);
  }, [session, requestSession]);

  const handleError = useCallback(
    (reason: string) => {
      // Ошибка защищённого воспроизведения — не повод показывать чёрный
      // экран: сообщаем о ней и переспрашиваем сессию уже без DRM.
      if (session?.drm && !drmFailedRef.current) {
        drmFailedRef.current = true;
        console.warn('[video] защищённое воспроизведение недоступно, переходим на запасной режим', {
          reason,
          sessionId: session.sessionId,
        });
        void requestSession();
        return;
      }
      console.warn('[video] плеер сообщил об ошибке', { reason, sessionId: session?.sessionId });
      setError(
        reason === 'revoked' || reason === 'access_lost'
          ? 'Доступ к просмотру отозван. Откройте урок заново.'
          : 'Видео не запускается. Попробуйте ещё раз или откройте урок позже.',
      );
    },
    [session, requestSession],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!session || !container) return;

    let cancelled = false;
    void (async () => {
      try {
        const handle = await createPlayer({
          container,
          session,
          startAtSec: positionRef.current,
          durationSec,
          callbacks: {
            onTime: (currentTime, percent) => {
              positionRef.current = currentTime;
              onProgress(currentTime, percent);
            },
            onEnded: () => onProgress(positionRef.current, 100, true),
            onError: handleError,
          },
        });
        if (cancelled) {
          handle.destroy();
          return;
        }
        playerRef.current = handle;
      } catch (e) {
        if (!cancelled) handleError(e instanceof Error ? e.message : 'player_init_failed');
      }
    })();

    return () => {
      cancelled = true;
      // Уход с экрана: досылаем последнюю позицию, иначе прогресс теряется.
      onProgress(positionRef.current, 0, true);
      playerRef.current?.destroy();
      playerRef.current = null;
    };
    // onProgress и handleError намеренно не в зависимостях: они пересоздаются
    // на каждый рендер, а пересоздавать из-за этого плеер нельзя.
  }, [session, durationSec]);

  if (error) {
    return (
      <Card>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>Видео недоступно</div>
        <div className="pdr-hint" style={{ marginBottom: 12 }}>
          {error}
        </div>
        <Button variant="secondary" block onClick={() => void requestSession()}>
          Повторить
        </Button>
      </Card>
    );
  }

  return (
    <div className="pdr-player">
      <div ref={containerRef} className="pdr-player__frame" />
      {loading ? (
        <div className="pdr-player__overlay">
          <Spinner />
        </div>
      ) : null}
    </div>
  );
}
