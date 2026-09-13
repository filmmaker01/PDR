/**
 * Очередь загрузки файлов.
 *
 * Загрузка идёт напрямую в хранилище по подписанной ссылке, поэтому файл
 * не проходит через наш сервер. Очередь переживает потерю связи: часть
 * повторяется, истёкшая ссылка запрашивается заново, уже загруженные файлы
 * не теряются.
 */

export type UploadStatus = 'queued' | 'uploading' | 'processing' | 'done' | 'error' | 'cancelled';

export interface UploadItem {
  /** Локальный идентификатор до появления серверного. */
  localId: string;
  fileId: string | null;
  file: File;
  previewUrl: string;
  status: UploadStatus;
  progress: number;
  error: string | null;
}

export interface PresignResponse {
  fileId: string;
  upload:
    | {
        kind: 'single';
        url: string;
        method: string;
        headers: Record<string, string>;
        expiresAt: string;
      }
    | {
        kind: 'multipart';
        uploadId: string;
        partSizeBytes: number;
        parts: { partNumber: number; url: string }[];
        expiresAt: string;
      };
}

export interface UploadTransport {
  presign(file: File): Promise<PresignResponse>;
  refresh(fileId: string): Promise<PresignResponse>;
  complete(fileId: string, parts?: { partNumber: number; etag: string }[]): Promise<void>;
}

const MAX_ATTEMPTS = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Загрузка одного тела с отслеживанием прогресса и возможностью отмены. */
function putWithProgress(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: Blob,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<{ etag: string | null }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url, true);
    for (const [key, value] of Object.entries(headers)) {
      // Content-Length браузер выставляет сам и запрещает задавать вручную.
      if (key.toLowerCase() === 'content-length') continue;
      xhr.setRequestHeader(key, value);
    }
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve({ etag: xhr.getResponseHeader('ETag') });
      } else {
        reject(new Error(`Хранилище ответило ${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error('Не удалось передать файл'));
    xhr.ontimeout = () => reject(new Error('Превышено время ожидания'));
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.onabort = () => reject(new DOMException('Отменено', 'AbortError'));
    xhr.send(body);
  });
}

export async function uploadOne(
  file: File,
  transport: UploadTransport,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<string> {
  let presigned = await transport.presign(file);

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      if (presigned.upload.kind === 'single') {
        await putWithProgress(
          presigned.upload.url,
          presigned.upload.method,
          presigned.upload.headers,
          file,
          onProgress,
          signal,
        );
        await transport.complete(presigned.fileId);
      } else {
        const { partSizeBytes, parts } = presigned.upload;
        const completed: { partNumber: number; etag: string }[] = [];
        for (const part of parts) {
          const start = (part.partNumber - 1) * partSizeBytes;
          const chunk = file.slice(start, Math.min(start + partSizeBytes, file.size));
          if (chunk.size === 0) continue;
          const result = await putWithProgress(
            part.url,
            'PUT',
            {},
            chunk,
            (fraction) => onProgress((part.partNumber - 1 + fraction) / parts.length),
            signal,
          );
          completed.push({ partNumber: part.partNumber, etag: result.etag ?? 'local' });
        }
        await transport.complete(presigned.fileId, completed);
      }
      onProgress(1);
      return presigned.fileId;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      if (attempt === MAX_ATTEMPTS) throw error;
      // Ссылка могла истечь, пока не было связи: берём новую и продолжаем.
      await sleep(attempt * 1000);
      presigned = await transport.refresh(presigned.fileId);
    }
  }
  throw new Error('Не удалось загрузить файл');
}
