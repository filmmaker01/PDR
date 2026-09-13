import { useEffect, useRef, useState } from 'react';
import type { LessonDetails } from './types';

interface Props {
  video: NonNullable<LessonDetails['video']>;
  startAtSec: number;
  onProgress: (positionSec: number, percent: number, force?: boolean) => void;
}

/**
 * Плеер урока.
 *
 * Если провайдер отдаёт HLS — используем собственный элемент video: так
 * контролируется восстановление позиции и отправка прогресса. Иначе
 * встраиваем плеер провайдера, и прогресс отмечается вручную.
 */
export function VideoPlayer({ video, startAtSec, onProgress }: Props) {
  const ref = useRef<HTMLVideoElement>(null);
  const [restored, setRestored] = useState(false);
  const canPlayNatively = Boolean(video.hlsUrl);

  useEffect(() => {
    const element = ref.current;
    if (!element || !canPlayNatively) return;

    const handleLoaded = (): void => {
      if (!restored && startAtSec > 0 && startAtSec < element.duration - 5) {
        element.currentTime = startAtSec;
      }
      setRestored(true);
    };
    const handleTimeUpdate = (): void => {
      if (element.duration > 0) {
        onProgress(element.currentTime, (element.currentTime / element.duration) * 100);
      }
    };
    const handlePause = (): void => {
      if (element.duration > 0) {
        onProgress(element.currentTime, (element.currentTime / element.duration) * 100, true);
      }
    };

    element.addEventListener('loadedmetadata', handleLoaded);
    element.addEventListener('timeupdate', handleTimeUpdate);
    element.addEventListener('pause', handlePause);
    element.addEventListener('ended', handlePause);

    return () => {
      element.removeEventListener('loadedmetadata', handleLoaded);
      element.removeEventListener('timeupdate', handleTimeUpdate);
      element.removeEventListener('pause', handlePause);
      element.removeEventListener('ended', handlePause);
    };
  }, [canPlayNatively, onProgress, restored, startAtSec]);

  if (canPlayNatively) {
    return (
      <div className="pdr-player">
        <video
          ref={ref}
          className="pdr-player__video"
          src={video.hlsUrl ?? undefined}
          poster={video.posterUrl ?? undefined}
          controls
          playsInline
          preload="metadata"
        />
      </div>
    );
  }

  return (
    <div className="pdr-player">
      <iframe
        className="pdr-player__frame"
        src={video.embedUrl ?? ''}
        title="Видеоурок"
        allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
        allowFullScreen
      />
    </div>
  );
}
