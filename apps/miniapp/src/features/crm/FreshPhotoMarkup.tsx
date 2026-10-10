import { useRef, useState } from 'react';
import { ApiError } from '@pdr/api-client';
import type { UploadItem } from '@pdr/ui';
import { api } from '@/shared/api';
import { alertDialog } from '@/shared/telegram';
import type { DraftPhotoMarkup } from './PhotoMarkupSheet';

/**
 * Очередь снимков, которые ждут разметки сразу после съёмки или выбора.
 *
 * Сделал фото → «Использовать фото» → сразу редактор зоны ремонта. Из
 * галереи можно выбрать несколько снимков: тогда редактор открывается
 * по очереди, после «Готово» или «Пропустить» — следующий.
 */
export function useFreshMarkupQueue() {
  const [queue, setQueue] = useState<string[]>([]);

  return {
    /** Видео не размечается: в очередь попадают только снимки. */
    enqueue: (items: readonly UploadItem[]): void => {
      const ids = items
        .filter((item) => item.file.type === '' || item.file.type.startsWith('image/'))
        .map((item) => item.localId);
      if (ids.length > 0) setQueue((current) => [...current, ...ids]);
    },
    current: queue[0] ?? null,
    /**
     * Снимок размечен, пропущен или убран. По идентификатору, а не «первый в
     * очереди»: удаление снимка и закрытие редактора не должны снять два.
     */
    drop: (localId: string): void => setQueue((current) => current.filter((id) => id !== localId)),
  };
}

/**
 * Разметка снимка, который загружается в уже сохранённую запись.
 *
 * Мастер размечает сразу, а снимок ещё в пути: у него нет номера в базе.
 * Поэтому разметка ждёт рядом и уходит на сервер, как только снимок
 * привязан к записи, — или сразу, если загрузка закончилась раньше.
 */
export function useMarkupAfterUpload(workspaceId: string, invalidate: () => Promise<void>) {
  const photoIds = useRef(new Map<string, string>());
  const pending = useRef(new Map<string, DraftPhotoMarkup>());
  const discarded = useRef(new Set<string>());

  const apply = async (localId: string): Promise<void> => {
    const photoId = photoIds.current.get(localId);
    const markup = pending.current.get(localId);
    if (!photoId || !markup) return;
    pending.current.delete(localId);
    try {
      if (markup.annotation) {
        await api.post(`/workspaces/${workspaceId}/photos/${photoId}/markup`, {
          annotation: markup.annotation,
          ...(markup.annotationFileId ? { annotationFileId: markup.annotationFileId } : {}),
        });
      }
      if (markup.damageKey) {
        await api.patch(`/workspaces/${workspaceId}/photos/${photoId}`, {
          damageId: markup.damageKey,
        });
      }
      await invalidate();
    } catch (e) {
      await alertDialog(
        e instanceof ApiError
          ? e.message
          : 'Фото добавлено, но разметку сохранить не удалось. Откройте «Отметить зону ремонта» ещё раз.',
      );
    }
  };

  return {
    /** Снимок привязан к записи и получил номер в базе. */
    attached: async (localId: string, photoId: string): Promise<void> => {
      photoIds.current.set(localId, photoId);
      if (discarded.current.has(localId)) {
        // Мастер отказался от снимка, пока он загружался.
        await api.delete(`/workspaces/${workspaceId}/photos/${photoId}`);
        await invalidate();
        return;
      }
      await apply(localId);
    },
    save: (localId: string, markup: DraftPhotoMarkup): void => {
      if (!markup.annotation && !markup.damageKey) return;
      pending.current.set(localId, markup);
      void apply(localId);
    },
    /** «Не добавлять это фото» из редактора. */
    discard: async (localId: string, removeUpload: (localId: string) => void): Promise<void> => {
      pending.current.delete(localId);
      const photoId = photoIds.current.get(localId);
      removeUpload(localId);
      if (photoId) {
        await api.delete(`/workspaces/${workspaceId}/photos/${photoId}`);
        await invalidate();
      } else {
        discarded.current.add(localId);
      }
    },
  };
}
