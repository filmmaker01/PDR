import { useRef } from 'react';
import clsx from 'clsx';
import type { UploadItem } from './upload';

export interface MediaUploaderProps {
  items: UploadItem[];
  onAdd: (files: FileList) => void;
  onRetry: (localId: string) => void;
  onRemove: (localId: string) => void;
  accept?: string;
  /** Съёмка сразу с камеры: важнее всего для фото «до/после». */
  capture?: boolean;
  label?: string;
  hint?: string;
  disabled?: boolean;
  maxFiles?: number;
}

export function MediaUploader({
  items,
  onAdd,
  onRetry,
  onRemove,
  accept = 'image/*',
  capture,
  label = 'Добавить фото',
  hint,
  disabled,
  maxFiles,
}: MediaUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const full = maxFiles !== undefined && items.length >= maxFiles;

  return (
    <div className="pdr-uploader">
      <div className="pdr-uploader__grid">
        {items.map((item) => (
          <div key={item.localId} className="pdr-uploader__tile">
            {item.file.type.startsWith('video/') ? (
              <video src={item.previewUrl} className="pdr-uploader__media" muted playsInline />
            ) : (
              <img src={item.previewUrl} alt="" className="pdr-uploader__media" />
            )}

            {item.status === 'uploading' || item.status === 'queued' ? (
              <div className="pdr-uploader__overlay">
                <div className="pdr-uploader__bar">
                  <div className="pdr-uploader__bar-fill" style={{ width: `${item.progress}%` }} />
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
        ))}

        {!full ? (
          <button
            type="button"
            className="pdr-uploader__add"
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
          >
            <span style={{ fontSize: 24, lineHeight: 1 }}>＋</span>
            <span>{label}</span>
          </button>
        ) : null}
      </div>

      {hint ? <div className="pdr-hint">{hint}</div> : null}

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple
        {...(capture ? { capture: 'environment' as const } : {})}
        hidden
        onChange={(e) => {
          if (e.target.files?.length) onAdd(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}
