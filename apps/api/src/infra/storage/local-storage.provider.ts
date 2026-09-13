import { Injectable, Logger } from '@nestjs/common';
import { createHmac, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { AppConfigService } from '@/config/config.service';
import type {
  CompletedPart,
  MultipartUpload,
  ObjectHead,
  PresignedUpload,
  StorageProvider,
} from './storage.types';

/**
 * Хранилище поверх файловой системы для разработки и тестов.
 * Подписанные ссылки эмулируются собственным эндпоинтом API с HMAC-подписью,
 * поэтому поведение клиента ничем не отличается от работы с S3.
 * На staging и production запрещено проверкой конфигурации.
 */
@Injectable()
export class LocalStorageProvider implements StorageProvider {
  readonly kind = 'local' as const;
  readonly bucket: string;
  private readonly logger = new Logger(LocalStorageProvider.name);
  private readonly root: string;
  private readonly secret: string;
  private readonly baseUrl: string;

  constructor(private readonly config: AppConfigService) {
    this.bucket = config.env.S3_BUCKET;
    this.root = resolve(process.cwd(), config.env.STORAGE_LOCAL_DIR);
    this.secret = config.env.SESSION_JWT_SECRET;
    this.baseUrl = `${config.env.PUBLIC_API_URL}/v1/files/local`;
    // Путь раскрывается от рабочего каталога процесса: если API и сидер
    // запущены из разных каталогов, файлы окажутся в разных местах. Корень
    // пишется в лог, чтобы это было видно сразу, а не по 404 на картинке.
    this.logger.log(`Локальное хранилище: ${this.root}`);
  }

  private pathFor(key: string): string {
    const safe = key.replace(/\.\./g, '').replace(/^\/+/, '');
    return join(this.root, safe);
  }

  /** Подпись ссылки: ключ + операция + срок. */
  sign(key: string, op: 'put' | 'get', expiresAtMs: number): string {
    return createHmac('sha256', this.secret)
      .update(`${op}:${key}:${expiresAtMs}`)
      .digest('base64url');
  }

  verify(key: string, op: 'put' | 'get', expiresAtMs: number, signature: string): boolean {
    if (Date.now() > expiresAtMs) return false;
    return this.sign(key, op, expiresAtMs) === signature;
  }

  private url(
    key: string,
    op: 'put' | 'get',
    ttlSec: number,
    downloadName?: string,
  ): { url: string; expiresAt: Date } {
    const expiresAt = new Date(Date.now() + ttlSec * 1000);
    const params = new URLSearchParams({
      key,
      op,
      expires: String(expiresAt.getTime()),
      sig: this.sign(key, op, expiresAt.getTime()),
    });
    if (downloadName) params.set('name', downloadName);
    return { url: `${this.baseUrl}?${params.toString()}`, expiresAt };
  }

  async presignUpload(
    key: string,
    contentType: string,
    _sizeBytes: number,
    ttlSec: number,
  ): Promise<PresignedUpload> {
    const { url, expiresAt } = this.url(key, 'put', ttlSec);
    return { url, method: 'PUT', headers: { 'Content-Type': contentType }, expiresAt };
  }

  async createMultipartUpload(
    key: string,
    contentType: string,
    sizeBytes: number,
    ttlSec: number,
  ): Promise<MultipartUpload> {
    const partSizeBytes = 10 * 1024 * 1024;
    const count = Math.max(1, Math.ceil(sizeBytes / partSizeBytes));
    const uploadId = randomUUID();
    const parts = Array.from({ length: count }, (_, i) => ({
      partNumber: i + 1,
      url: this.url(`${key}.part${i + 1}.${uploadId}`, 'put', ttlSec).url,
    }));
    void contentType;
    return {
      uploadId,
      partSizeBytes,
      parts,
      expiresAt: new Date(Date.now() + ttlSec * 1000),
    };
  }

  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: CompletedPart[],
  ): Promise<void> {
    const ordered = [...parts].sort((a, b) => a.partNumber - b.partNumber);
    const chunks: Buffer[] = [];
    for (const part of ordered) {
      chunks.push(await readFile(this.pathFor(`${key}.part${part.partNumber}.${uploadId}`)));
    }
    await this.put(key, Buffer.concat(chunks), 'application/octet-stream');
    await this.abortMultipartUpload(key, uploadId);
  }

  async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    const dir = dirname(this.pathFor(key));
    const base = key.split('/').pop() ?? key;
    const entries = await readdir(dir).catch(() => [] as string[]);
    await Promise.all(
      entries
        .filter((name) => name.startsWith(`${base}.part`) && name.endsWith(uploadId))
        .map((name) => rm(join(dir, name), { force: true })),
    );
  }

  async presignDownload(key: string, ttlSec: number, downloadName?: string): Promise<string> {
    return this.url(key, 'get', ttlSec, downloadName).url;
  }

  async head(key: string): Promise<ObjectHead | null> {
    try {
      const info = await stat(this.pathFor(key));
      return { sizeBytes: info.size, contentType: null, etag: null };
    } catch {
      return null;
    }
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.pathFor(key));
  }

  async put(key: string, body: Buffer, _contentType: string): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true }).catch((err: unknown) => {
      this.logger.warn({ err, key }, 'Не удалось удалить файл');
    });
  }
}
