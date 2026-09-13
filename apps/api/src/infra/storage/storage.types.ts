export interface PresignedUpload {
  /** Куда класть тело файла. Для multipart — список ссылок на части. */
  url: string;
  method: 'PUT' | 'POST';
  headers: Record<string, string>;
  expiresAt: Date;
}

export interface MultipartUpload {
  uploadId: string;
  partSizeBytes: number;
  parts: { partNumber: number; url: string }[];
  expiresAt: Date;
}

export interface CompletedPart {
  partNumber: number;
  etag: string;
}

export interface ObjectHead {
  sizeBytes: number;
  contentType: string | null;
  etag: string | null;
}

/**
 * Абстракция хранилища. Реализации: S3-совместимое (staging/production)
 * и локальная файловая система (разработка и тесты без Docker).
 */
export interface StorageProvider {
  readonly bucket: string;
  readonly kind: 's3' | 'local';

  presignUpload(
    key: string,
    contentType: string,
    sizeBytes: number,
    ttlSec: number,
  ): Promise<PresignedUpload>;
  createMultipartUpload(
    key: string,
    contentType: string,
    sizeBytes: number,
    ttlSec: number,
  ): Promise<MultipartUpload>;
  completeMultipartUpload(key: string, uploadId: string, parts: CompletedPart[]): Promise<void>;
  abortMultipartUpload(key: string, uploadId: string): Promise<void>;

  presignDownload(key: string, ttlSec: number, downloadName?: string): Promise<string>;
  head(key: string): Promise<ObjectHead | null>;
  get(key: string): Promise<Buffer>;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
}
