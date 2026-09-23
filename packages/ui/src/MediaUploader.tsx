import { useRef, type ReactNode } from 'react';
import clsx from 'clsx';
import type { UploadItem } from './upload';

export interface MediaUploaderProps {
  items: UploadItem[];
  onAdd: (files: FileList) => void;
  onRetry: (localId: string) => void;
  onRemove: (localId: string) => void;
  accept?: string;
  /**
   * Предлагать съёмку с камеры отдельной кнопкой.
   *
   * Атрибут `capture` на одном поле — это выбор «или камера, или галерея»:
   * в Telegram Mini App на iOS он открывает сразу камеру, и снимки, которые
   * клиент уже прислал в переписке, приложить нечем. Поэтому операций две,
   * и каждая названа своим словом.
   */
  capture?: boolean;
  label?: string;
  cameraLabel?: string;
  galleryLabel?: string;
  hint?: string;
  disabled?: boolean;
  maxFiles?: number;
  /**
   * Что показать под миниатюрой: например, разметку зоны ремонта. Так
   * снимок можно разметить ещё до того, как запись сохранена в базе.
   */
  renderTileFooter?: (item: UploadItem) => ReactNode;
}

export function MediaUploader({
  items,
  onAdd,
  onRetry,
  onRemove,
  accept = 'image/*',
  capture,
  label = 'Добавить фото',
  cameraLabel = '📷 Снять фото',
  galleryLabel = '🖼 Выбрать из галереи',
  hint,
  disabled,
  maxFiles,
  renderTileFooter,
}: MediaUploaderProps) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const full = maxFiles !== undefined && items.length >= maxFiles;

  const pick = (files: FileList | null, input: HTMLInputElement): void => {
    if (files?.length) onAdd(files);
    // Сброс значения: иначе повторный выбор того же файла не даёт события.
    input.value = '';
  };

  return (
    <div className="pdr-uploader">
      <div
        className={clsx('pdr-uploader__grid', renderTileFooter && 'pdr-uploader__grid--footers')}
      >
        {items.map((item) => (
          <div key={item.localId} className="pdr-uploader__cell">
            <div className="pdr-uploader__tile">
              {item.file.type.startsWith('video/') ? (
                <video src={item.previewUrl} className="pdr-uploader__media" muted playsInline />
              ) : (
                <img src={item.previewUrl} alt="" className="pdr-uploader__media" />
              )}

              {item.status === 'uploading' || item.status === 'queued' ? (
                <div className="pdr-uploader__overlay">
                  <div className="pdr-uploader__bar">
                    <div
                      className="pdr-uploader__bar-fill"
                      style={{ width: `${item.progress}%` }}
                    />
                  </div>
                  <span>{item.status === 'queued' ? 'в очереди' : `${item.progress}%`}</span>
                </div>
              ) : null}

              {item.status === 'error' ? (
                <button
                  type="button"
                  className={clsx('pdr-uploader__overlay', 'pdr-uploader__overlay--error')}
                  onClick={() => onRetry(item.localId)}
                >
                  <span>Не загрузилось</span>
                  <span style={{ textDecoration: 'underline' }}>Повторить</span>
                </button>
              ) : null}

              <button
                type="button"
                className="pdr-uploader__remove"
                aria-label="Убрать"
                onClick={() => onRemove(item.localId)}
              >
                ×
              </button>
            </div>
            {renderTileFooter?.(item)}
          </div>
        ))}
      </div>

      {!full ? (
        <div className="pdr-uploader__actions">
          {capture ? (
            <>
              <button
                type="button"
                className="pdr-uploader__action"
                disabled={disabled}
                onClick={() => cameraRef.current?.click()}
              >
                {cameraLabel}
              </button>
              <button
                type="button"
                className="pdr-uploader__action"
                disabled={disabled}
                onClick={() => galleryRef.current?.click()}
              >
                {galleryLabel}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="pdr-uploader__action"
              disabled={disabled}
              onClick={() => galleryRef.current?.click()}
            >
              {label}
            </button>
          )}
        </div>
      ) : null}

      {hint ? <div className="pdr-hint">{hint}</div> : null}

      {/* Съёмка: одно поле с capture. Галерея — второе, без него и с multiple. */}
      <input
        ref={cameraRef}
        type="file"
        accept={accept}
        capture="environment"
        hidden
        onChange={(e) => pick(e.target.files, e.target)}
      />
      <input
        ref={galleryRef}
        type="file"
        accept={accept}
        multiple
        hidden
        onChange={(e) => pick(e.target.files, e.target)}
      />
    </div>
  );
}
