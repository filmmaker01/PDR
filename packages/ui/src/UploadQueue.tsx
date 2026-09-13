import { useCallback, useEffect, useRef, useState } from 'react';
import { uploadOne, type UploadItem, type UploadTransport } from './upload';

let counter = 0;
function nextLocalId(): string {
  counter += 1;
  return `upload-${counter}-${Date.now()}`;
}

export interface UseUploadQueueOptions {
  transport: UploadTransport;
  /** Вызывается, когда файл полностью загружен и подтверждён. */
  onUploaded?: (fileId: string, item: UploadItem) => void | Promise<void>;
  maxFiles?: number;
}

/**
 * Управление очередью загрузок в интерфейсе.
 * Загрузки идут по одной: на мобильной сети параллельные отправки
 * заметно чаще срываются.
 */
export function useUploadQueue({ transport, onUploaded, maxFiles }: UseUploadQueueOptions) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const abortControllers = useRef(new Map<string, AbortController>());
  const running = useRef(false);
  const queue = useRef<UploadItem[]>([]);

  const patch = useCallback((localId: string, changes: Partial<UploadItem>) => {
    setItems((current) =>
      current.map((item) => (item.localId === localId ? { ...item, ...changes } : item)),
    );
  }, []);

  const pump = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      for (;;) {
        const next = queue.current.shift();
        if (!next) break;

        const controller = new AbortController();
        abortControllers.current.set(next.localId, controller);
        patch(next.localId, { status: 'uploading', progress: 0, error: null });

        try {
          const fileId = await uploadOne(
            next.file,
            transport,
            (fraction) => patch(next.localId, { progress: Math.round(fraction * 100) }),
            controller.signal,
          );
          patch(next.localId, { status: 'done', progress: 100, fileId });
          await onUploaded?.(fileId, next);
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') {
            patch(next.localId, { status: 'cancelled' });
          } else {
            patch(next.localId, {
              status: 'error',
              error: error instanceof Error ? error.message : 'Ошибка загрузки',
            });
          }
        } finally {
          abortControllers.current.delete(next.localId);
        }
      }
    } finally {
      running.current = false;
    }
  }, [onUploaded, patch, transport]);

  const add = useCallback(
    (files: FileList | File[]) => {
      const list = Array.from(files);
      setItems((current) => {
        const room = maxFiles ? Math.max(0, maxFiles - current.length) : list.length;
        const accepted = list.slice(0, room).map<UploadItem>((file) => ({
          localId: nextLocalId(),
          fileId: null,
          file,
          previewUrl: URL.createObjectURL(file),
          status: 'queued',
          progress: 0,
          error: null,
        }));
        queue.current.push(...accepted);
        void pump();
        return [...current, ...accepted];
      });
    },
    [maxFiles, pump],
  );

  const retry = useCallback(
    (localId: string) => {
      setItems((current) => {
        const item = current.find((i) => i.localId === localId);
        if (item) {
          queue.current.push({ ...item, status: 'queued', progress: 0, error: null });
          void pump();
        }
        return current.map((i) =>
          i.localId === localId ? { ...i, status: 'queued', error: null, progress: 0 } : i,
        );
      });
    },
    [pump],
  );

  const cancel = useCallback((localId: string) => {
    abortControllers.current.get(localId)?.abort();
    queue.current = queue.current.filter((i) => i.localId !== localId);
  }, []);

  const remove = useCallback((localId: string) => {
    abortControllers.current.get(localId)?.abort();
    queue.current = queue.current.filter((i) => i.localId !== localId);
    setItems((current) => {
      const item = current.find((i) => i.localId === localId);
      if (item) URL.revokeObjectURL(item.previewUrl);
      return current.filter((i) => i.localId !== localId);
    });
  }, []);

  const clear = useCallback(() => {
    for (const controller of abortControllers.current.values()) controller.abort();
    abortControllers.current.clear();
    queue.current = [];
    setItems((current) => {
      current.forEach((i) => URL.revokeObjectURL(i.previewUrl));
      return [];
    });
  }, []);

  useEffect(() => {
    const controllers = abortControllers.current;
    return () => {
      for (const controller of controllers.values()) controller.abort();
    };
  }, []);

  const pending = items.some((i) => i.status === 'queued' || i.status === 'uploading');

  return { items, add, retry, cancel, remove, clear, pending };
}
