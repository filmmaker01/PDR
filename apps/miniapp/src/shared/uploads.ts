import { uploadOne, type PresignResponse, type UploadTransport } from '@pdr/ui';
import { api } from './api';

export interface UploadScopeOptions {
  scope: 'order_photo' | 'submission' | 'exam_attempt' | 'avatar';
  workspaceId?: string;
}

/** Транспорт загрузки: presign → прямая отправка в хранилище → подтверждение. */
export function createUploadTransport(options: UploadScopeOptions): UploadTransport {
  return {
    presign: (file) =>
      api.post<PresignResponse>('/files/presign-upload', {
        scope: options.scope,
        mimeType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
        originalName: file.name,
        workspaceId: options.workspaceId,
      }),
    refresh: (fileId) => api.post<PresignResponse>(`/files/${fileId}/refresh-upload`),
    complete: async (fileId, parts) => {
      await api.post(`/files/${fileId}/complete`, parts ? { parts } : {});
    },
  };
}

export async function fileUrl(
  fileId: string,
  variant: 'original' | 'thumb' | 'preview' = 'thumb',
): Promise<string> {
  const result = await api.get<{ url: string }>(`/files/${fileId}/url`, { query: { variant } });
  return result.url;
}

/**
 * Разовая загрузка одного файла без очереди.
 *
 * Нужна для сведённой картинки с разметкой: она собирается на лету и должна
 * уехать в хранилище сразу, а не встать в общий список «добавленных снимков».
 */
export async function uploadBlob(
  blob: Blob,
  name: string,
  options: UploadScopeOptions,
): Promise<string> {
  const file = new File([blob], name, { type: blob.type || 'image/jpeg' });
  return uploadOne(file, createUploadTransport(options), () => {});
}
