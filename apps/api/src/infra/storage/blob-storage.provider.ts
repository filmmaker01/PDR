import { Injectable, Logger } from '@nestjs/common';
import { issueSignedToken, presignUrl, put, type IssuedSignedToken } from '@vercel/blob';
import { AppConfigService } from '@/config/config.service';
import { AppError } from '@/common/errors/app.error';
import type {
  CompletedPart,
  MultipartUpload,
  ObjectHead,
  PresignedUpload,
  StorageProvider,
} from './storage.types';

type Operation = 'get' | 'head' | 'put' | 'delete';

/** Запас, чтобы не подписать ссылку токеном, истекающим прямо сейчас. */
const TOKEN_REFRESH_MARGIN_MS = 60_000;
const TOKEN_TTL_MS = 60 * 60 * 1000;

/**
 * Хранилище поверх Vercel Blob.
 *
 * Загрузка и скачивание идут мимо функции: сервер только подписывает ссылку,
 * а браузер обращается к хранилищу напрямую. Иначе файлы упирались бы в предел
 * размера тела запроса функции.
 *
 * Подпись устроена в два шага: `issueSignedToken` ходит в управляющий API и
 * выдаёт материал для подписи, а `presignUrl` подписывает конкретный путь уже
 * локально. Токен выдаётся на всё хранилище и кэшируется — иначе каждая ссылка
 * стоила бы отдельного обращения к API.
 */
@Injectable()
export class BlobStorageProvider implements StorageProvider {
  readonly kind = 'blob' as const;
  readonly bucket: string;

  private readonly logger = new Logger(BlobStorageProvider.name);
  private readonly tokens = new Map<string, { token: IssuedSignedToken; validUntil: number }>();

  constructor(private readonly config: AppConfigService) {
    this.bucket = config.env.S3_BUCKET;
  }

  /**
   * Токен на всё хранилище под набор операций.
   * Ограничения на тип и размер задаются при подписи конкретной ссылки.
   */
  private async signedToken(operations: Operation[]): Promise<IssuedSignedToken> {
    const key = operations.slice().sort().join(',');
    const cached = this.tokens.get(key);
    if (cached && cached.validUntil - TOKEN_REFRESH_MARGIN_MS > Date.now()) {
      return cached.token;
    }

    const token = await issueSignedToken({
      pathname: '*',
      operations,
      validUntil: Date.now() + TOKEN_TTL_MS,
    });
    this.tokens.set(key, { token, validUntil: token.validUntil });
    return token;
  }

  async presignUpload(
    key: string,
    contentType: string,
    sizeBytes: number,
    ttlSec: number,
  ): Promise<PresignedUpload> {
    const token = await this.signedToken(['put']);
    const expiresAt = new Date(Date.now() + ttlSec * 1000);

    // Тип и размер зашиты в подпись: подменить их при загрузке нельзя.
    const { presignedUrl } = await presignUrl(token, {
      operation: 'put',
      pathname: key,
      access: 'private',
      allowedContentTypes: [contentType],
      maximumSizeInBytes: sizeBytes,
      addRandomSuffix: false,
      allowOverwrite: true,
      validUntil: expiresAt.getTime(),
    });

    return {
      url: presignedUrl,
      method: 'PUT',
      headers: { 'content-type': contentType },
      expiresAt,
    };
  }

  /**
   * Составная загрузка у Vercel Blob устроена через SDK, а не через ссылки на
   * части, поэтому отдать браузеру список ссылок нечем. Файлы больше порога
   * составной загрузки — это видео, а они идут к видеопровайдеру, не сюда.
   */
  createMultipartUpload(): Promise<MultipartUpload> {
    throw new AppError(
      'file_too_large',
      'Файл слишком велик для этого хранилища: составная загрузка недоступна',
    );
  }

  completeMultipartUpload(_key: string, _uploadId: string, _parts: CompletedPart[]): Promise<void> {
    throw new AppError('file_too_large', 'Составная загрузка недоступна');
  }

  abortMultipartUpload(): Promise<void> {
    return Promise.resolve();
  }

  async presignDownload(key: string, ttlSec: number, downloadName?: string): Promise<string> {
    const token = await this.signedToken(['get']);
    const { presignedUrl } = await presignUrl(token, {
      operation: 'get',
      pathname: key,
      access: 'private',
      validUntil: Date.now() + ttlSec * 1000,
    });

    if (downloadName) {
      // Имя файла при скачивании задаётся в подписанной ссылке не всегда;
      // для отладки полезно видеть, какое имя ожидалось.
      this.logger.debug({ key, downloadName }, 'Имя файла при скачивании не задаётся хранилищем');
    }
    return presignedUrl;
  }

  async head(key: string): Promise<ObjectHead | null> {
    const token = await this.signedToken(['head']);
    const { presignedUrl } = await presignUrl(token, {
      operation: 'head',
      pathname: key,
      access: 'private',
    });

    const res = await fetch(presignedUrl, { method: 'HEAD' });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Не удалось прочитать объект ${key}: ${res.status}`);

    const size = res.headers.get('content-length');
    return {
      sizeBytes: size ? Number(size) : 0,
      contentType: res.headers.get('content-type'),
      etag: res.headers.get('etag'),
    };
  }

  async get(key: string): Promise<Buffer> {
    const token = await this.signedToken(['get']);
    const { presignedUrl } = await presignUrl(token, {
      operation: 'get',
      pathname: key,
      access: 'private',
      // Свежесть важнее кэша: объект могли только что перезаписать.
      useCache: false,
    });

    const res = await fetch(presignedUrl);
    if (!res.ok) throw new Error(`Не удалось скачать объект ${key}: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await put(key, body, {
      access: 'private',
      contentType,
      addRandomSuffix: false,
      allowOverwrite: true,
    });
  }

  async delete(key: string): Promise<void> {
    const token = await this.signedToken(['delete']);
    const { presignedUrl } = await presignUrl(token, {
      operation: 'delete',
      pathname: key,
      access: 'private',
    });

    const res = await fetch(presignedUrl, { method: 'DELETE' });
    // Отсутствующий объект — не ошибка: удаление идемпотентно.
    if (!res.ok && res.status !== 404) {
      this.logger.warn({ key, status: res.status }, 'Не удалось удалить объект');
    }
  }
}
