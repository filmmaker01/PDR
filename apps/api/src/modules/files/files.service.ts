import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { FileScope, Prisma, StoredFile, User } from '@prisma/client';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { AppConfigService } from '@/config/config.service';
import { AppError } from '@/common/errors/app.error';
import { JobsService } from '@/infra/jobs/jobs.service';
import { JOB } from '@/infra/jobs/job-queue';
import { STORAGE_PROVIDER } from '@/infra/storage/storage.module';
import type { CompletedPart, StorageProvider } from '@/infra/storage/storage.types';
import { detectFileType, isImage, isVideo, matchesDeclared } from './file-type';
import { FileAccessRegistry } from './file-access.registry';

const MULTIPART_THRESHOLD_BYTES = 50 * 1024 * 1024;

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const VIDEO_TYPES = ['video/mp4', 'video/quicktime'];
const DOCUMENT_TYPES = ['application/pdf'];

/** Что можно загружать в каждый раздел. */
const SCOPE_RULES: Record<FileScope, { types: string[]; requiresWorkspace: boolean }> = {
  order_photo: { types: [...IMAGE_TYPES], requiresWorkspace: true },
  submission: { types: [...IMAGE_TYPES, ...VIDEO_TYPES], requiresWorkspace: false },
  exam_attempt: { types: [...IMAGE_TYPES, ...VIDEO_TYPES], requiresWorkspace: false },
  lesson_material: { types: [...IMAGE_TYPES, ...DOCUMENT_TYPES], requiresWorkspace: false },
  question_image: { types: [...IMAGE_TYPES], requiresWorkspace: false },
  course_cover: { types: [...IMAGE_TYPES], requiresWorkspace: false },
  avatar: { types: [...IMAGE_TYPES], requiresWorkspace: false },
  export: { types: ['application/zip', 'text/csv'], requiresWorkspace: false },
};

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'application/pdf': 'pdf',
  'application/zip': 'zip',
  'text/csv': 'csv',
};

export interface PresignInput {
  scope: FileScope;
  mimeType: string;
  sizeBytes: number;
  originalName?: string | null;
  workspaceId?: string | null;
  ownerUserId: string;
}

export interface PresignResult {
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

@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly jobs: JobsService,
    private readonly registry: FileAccessRegistry,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  private maxSizeFor(mimeType: string): number {
    if (isVideo(mimeType)) return this.config.env.FILE_MAX_SIZE_VIDEO;
    if (isImage(mimeType)) return this.config.env.FILE_MAX_SIZE_IMAGE;
    return this.config.env.FILE_MAX_SIZE_DOCUMENT;
  }

  private buildKey(input: PresignInput, fileId: string): string {
    const now = new Date();
    const owner = input.workspaceId ?? input.ownerUserId;
    const ext = EXTENSIONS[input.mimeType.toLowerCase()] ?? 'bin';
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    return `${input.scope}/${owner}/${yyyy}/${mm}/${fileId}.${ext}`;
  }

  async presign(input: PresignInput): Promise<PresignResult> {
    const mimeType = input.mimeType.toLowerCase().split(';')[0]?.trim() ?? '';
    const rule = SCOPE_RULES[input.scope];

    if (!rule.types.includes(mimeType)) {
      throw new AppError(
        'unsupported_file_type',
        `Этот формат не поддерживается. Допустимо: ${rule.types.join(', ')}`,
      );
    }
    if (rule.requiresWorkspace && !input.workspaceId) {
      throw AppError.validation('Для этого типа файла нужна мастерская');
    }
    if (input.sizeBytes <= 0) throw AppError.validation('Размер файла должен быть больше нуля');

    const maxSize = this.maxSizeFor(mimeType);
    if (input.sizeBytes > maxSize) {
      throw new AppError(
        'file_too_large',
        `Файл больше допустимых ${Math.round(maxSize / 1024 / 1024)} МБ`,
      );
    }

    const fileId = randomUUID();
    await this.assertWithinQuota(input);

    const storageKey = this.buildKey({ ...input, mimeType }, fileId);
    const ttl = this.config.env.S3_PRESIGN_UPLOAD_TTL_SEC;

    if (input.sizeBytes > MULTIPART_THRESHOLD_BYTES) {
      const multipart = await this.storage.createMultipartUpload(
        storageKey,
        mimeType,
        input.sizeBytes,
        ttl,
      );
      await this.createRecord(fileId, storageKey, mimeType, input, multipart.uploadId);
      return {
        fileId,
        upload: {
          kind: 'multipart',
          uploadId: multipart.uploadId,
          partSizeBytes: multipart.partSizeBytes,
          parts: multipart.parts,
          expiresAt: multipart.expiresAt.toISOString(),
        },
      };
    }

    const presigned = await this.storage.presignUpload(storageKey, mimeType, input.sizeBytes, ttl);
    await this.createRecord(fileId, storageKey, mimeType, input, null);
    return {
      fileId,
      upload: {
        kind: 'single',
        url: presigned.url,
        method: presigned.method,
        headers: presigned.headers,
        expiresAt: presigned.expiresAt.toISOString(),
      },
    };
  }

  /**
   * Квота хранилища мастерской. Проверяется до выдачи ссылки: отказ после
   * загрузки файла пользователь воспринимает как потерю работы.
   */
  private async assertWithinQuota(input: PresignInput): Promise<void> {
    const quotaMb = this.config.env.STORAGE_WORKSPACE_QUOTA_MB;
    if (quotaMb === 0 || !input.workspaceId) return;

    const used = await this.workspaceUsageBytes(input.workspaceId);
    const quotaBytes = quotaMb * 1024 * 1024;
    if (used + input.sizeBytes > quotaBytes) {
      throw new AppError(
        'file_too_large',
        'Хранилище мастерской заполнено. Удалите ненужные фотографии или обратитесь к администратору.',
        { usedBytes: used, quotaBytes },
      );
    }
  }

  private async createRecord(
    fileId: string,
    storageKey: string,
    mimeType: string,
    input: PresignInput,
    uploadId: string | null,
  ): Promise<void> {
    await this.prisma.storedFile.create({
      data: {
        id: fileId,
        ownerUserId: input.ownerUserId,
        workspaceId: input.workspaceId ?? null,
        scope: input.scope,
        storageKey,
        bucket: this.storage.bucket,
        mimeType,
        sizeBytes: BigInt(input.sizeBytes),
        originalName: input.originalName ?? null,
        status: 'pending',
        uploadId,
      },
    });
  }

  /**
   * Файл, созданный сервером (выгрузка, печатная форма): тело уже готово,
   * поэтому presign не нужен — кладём объект и сразу помечаем готовым.
   */
  async storeGenerated(input: {
    ownerUserId: string;
    workspaceId?: string | null;
    scope: FileScope;
    body: Buffer;
    mimeType: string;
    originalName: string;
  }): Promise<StoredFile> {
    const fileId = randomUUID();
    const mimeType = input.mimeType.toLowerCase().split(';')[0]?.trim() ?? '';
    const storageKey = this.buildKey(
      {
        ownerUserId: input.ownerUserId,
        workspaceId: input.workspaceId ?? null,
        scope: input.scope,
        mimeType,
        sizeBytes: input.body.length,
      },
      fileId,
    );

    await this.storage.put(storageKey, input.body, mimeType);

    return this.prisma.storedFile.create({
      data: {
        id: fileId,
        ownerUserId: input.ownerUserId,
        workspaceId: input.workspaceId ?? null,
        scope: input.scope,
        storageKey,
        bucket: this.storage.bucket,
        mimeType,
        sizeBytes: BigInt(input.body.length),
        originalName: input.originalName,
        status: 'ready',
      },
    });
  }

  /** Повторная выдача ссылки, если прежняя истекла, — без потери уже загруженного. */
  async refreshUpload(fileId: string, userId: string): Promise<PresignResult> {
    const file = await this.getOwnPending(fileId, userId);
    const ttl = this.config.env.S3_PRESIGN_UPLOAD_TTL_SEC;

    if (file.uploadId) {
      const multipart = await this.storage.createMultipartUpload(
        file.storageKey,
        file.mimeType,
        Number(file.sizeBytes),
        ttl,
      );
      await this.prisma.storedFile.update({
        where: { id: fileId },
        data: { uploadId: multipart.uploadId },
      });
      return {
        fileId,
        upload: {
          kind: 'multipart',
          uploadId: multipart.uploadId,
          partSizeBytes: multipart.partSizeBytes,
          parts: multipart.parts,
          expiresAt: multipart.expiresAt.toISOString(),
        },
      };
    }

    const presigned = await this.storage.presignUpload(
      file.storageKey,
      file.mimeType,
      Number(file.sizeBytes),
      ttl,
    );
    return {
      fileId,
      upload: {
        kind: 'single',
        url: presigned.url,
        method: presigned.method,
        headers: presigned.headers,
        expiresAt: presigned.expiresAt.toISOString(),
      },
    };
  }

  /** Подтверждение загрузки: сверяем факт и ставим обработку. */
  async complete(fileId: string, userId: string, parts?: CompletedPart[]): Promise<StoredFile> {
    const file = await this.getOwnPending(fileId, userId);

    if (file.uploadId) {
      if (!parts || parts.length === 0) {
        throw AppError.validation('Для многочастной загрузки нужен список частей');
      }
      await this.storage.completeMultipartUpload(file.storageKey, file.uploadId, parts);
    }

    const head = await this.storage.head(file.storageKey);
    if (!head) {
      throw new AppError('file_not_ready', 'Файл не найден в хранилище. Повторите загрузку');
    }
    if (head.sizeBytes !== Number(file.sizeBytes)) {
      await this.markFailed(
        fileId,
        `размер не совпал: заявлено ${file.sizeBytes}, получено ${head.sizeBytes}`,
      );
      throw AppError.validation('Размер загруженного файла не совпадает с заявленным');
    }

    const updated = await this.prisma.storedFile.update({
      where: { id: fileId },
      data: { status: 'uploaded', uploadId: null },
    });
    await this.jobs.enqueue(JOB.filesProcess, { fileId });
    return updated;
  }

  /**
   * Обработка после загрузки: проверка сигнатуры, размеры, миниатюры.
   * Вызывается worker'ом.
   */
  async process(fileId: string): Promise<void> {
    const file = await this.prisma.storedFile.findUnique({ where: { id: fileId } });
    if (!file || file.status === 'ready' || file.status === 'deleted') return;

    await this.prisma.storedFile.update({ where: { id: fileId }, data: { status: 'processing' } });

    try {
      const body = await this.storage.get(file.storageKey);
      const checksum = createHash('sha256').update(body).digest('hex');

      const detected = detectFileType(body.subarray(0, 64));
      if (!matchesDeclared(detected, file.mimeType)) {
        await this.storage.delete(file.storageKey).catch(() => undefined);
        await this.markFailed(
          fileId,
          `содержимое (${detected ?? 'неизвестно'}) не соответствует заявленному типу ${file.mimeType}`,
        );
        return;
      }

      const data: Prisma.StoredFileUpdateInput = { checksumSha256: checksum, status: 'ready' };

      if (isImage(detected)) {
        const { variants, width, height } = await this.processImage(file.storageKey, body);
        data.variants = variants;
        data.width = width;
        data.height = height;
      }

      await this.prisma.storedFile.update({ where: { id: fileId }, data });
      this.logger.log({ fileId, scope: file.scope }, 'Файл обработан');
    } catch (err) {
      this.logger.error({ err, fileId }, 'Ошибка обработки файла');
      await this.markFailed(fileId, (err as Error).message);
      throw err;
    }
  }

  /**
   * Миниатюра и предпросмотр. HEIC с айфона конвертируется в JPEG,
   * из производных удаляются метаданные (в том числе геометки).
   */
  private async processImage(
    storageKey: string,
    body: Buffer,
  ): Promise<{ variants: Record<string, string>; width: number | null; height: number | null }> {
    const sharp = (await import('sharp')).default;
    const base = storageKey.replace(/\.[^./]+$/, '');
    const variants: Record<string, string> = {};

    const image = sharp(body, { failOn: 'none' });
    const meta = await image.metadata();

    const thumb = await sharp(body, { failOn: 'none' })
      .rotate()
      .resize(400, 400, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 78 })
      .toBuffer();
    const thumbKey = `${base}.thumb.webp`;
    await this.storage.put(thumbKey, thumb, 'image/webp');
    variants.thumb = thumbKey;

    if ((meta.width ?? 0) > 1600 || (meta.height ?? 0) > 1600 || meta.format === 'heif') {
      const preview = await sharp(body, { failOn: 'none' })
        .rotate()
        .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 85 })
        .toBuffer();
      const previewKey = `${base}.preview.webp`;
      await this.storage.put(previewKey, preview, 'image/webp');
      variants.preview = previewKey;
    }

    return { variants, width: meta.width ?? null, height: meta.height ?? null };
  }

  private async markFailed(fileId: string, error: string): Promise<void> {
    await this.prisma.storedFile.update({
      where: { id: fileId },
      data: { status: 'failed', error: error.slice(0, 500) },
    });
  }

  async getById(fileId: string): Promise<StoredFile> {
    const file = await this.prisma.storedFile.findUnique({ where: { id: fileId } });
    if (!file || file.status === 'deleted' || file.deletedAt) {
      throw AppError.notFound('Файл не найден');
    }
    return file;
  }

  /** Ссылка на скачивание после проверки доступа по привязке файла. */
  async downloadUrl(
    fileId: string,
    user: User,
    platformRoles: string[],
    variant: 'original' | 'thumb' | 'preview' = 'original',
  ): Promise<{ url: string; expiresAt: string }> {
    const file = await this.getById(fileId);
    const allowed = await this.registry.isAllowed({ file, user, platformRoles, intent: 'read' });
    if (!allowed) throw AppError.notFound('Файл не найден');

    if (file.status !== 'ready' && variant !== 'original') {
      throw new AppError('file_not_ready', 'Файл ещё обрабатывается');
    }

    const variants = (file.variants ?? {}) as Record<string, string>;
    const key = variant === 'original' ? file.storageKey : (variants[variant] ?? file.storageKey);
    const ttl = this.config.env.S3_PRESIGN_DOWNLOAD_TTL_SEC;
    const url = await this.storage.presignDownload(
      key,
      ttl,
      variant === 'original' ? (file.originalName ?? undefined) : undefined,
    );
    return { url, expiresAt: new Date(Date.now() + ttl * 1000).toISOString() };
  }

  /** Ссылки пачкой: списки фотографий не должны делать N запросов. */
  async downloadUrls(
    fileIds: string[],
    user: User,
    platformRoles: string[],
    variant: 'original' | 'thumb' | 'preview' = 'thumb',
  ): Promise<Record<string, string>> {
    const files = await this.prisma.storedFile.findMany({
      where: { id: { in: fileIds }, deletedAt: null },
    });
    const ttl = this.config.env.S3_PRESIGN_DOWNLOAD_TTL_SEC;
    const result: Record<string, string> = {};

    for (const file of files) {
      const allowed = await this.registry.isAllowed({ file, user, platformRoles, intent: 'read' });
      if (!allowed) continue;
      const variants = (file.variants ?? {}) as Record<string, string>;
      const key = variant === 'original' ? file.storageKey : (variants[variant] ?? file.storageKey);
      result[file.id] = await this.storage.presignDownload(key, ttl);
    }
    return result;
  }

  /** Мягкое удаление: объект стирается фоновой задачей через 30 дней. */
  async softDelete(fileId: string, user: User, platformRoles: string[]): Promise<void> {
    const file = await this.getById(fileId);
    const allowed = await this.registry.isAllowed({ file, user, platformRoles, intent: 'write' });
    if (!allowed) throw AppError.notFound('Файл не найден');

    await this.prisma.storedFile.update({
      where: { id: fileId },
      data: { status: 'deleted', deletedAt: new Date() },
    });
  }

  private async getOwnPending(fileId: string, userId: string): Promise<StoredFile> {
    const file = await this.prisma.storedFile.findUnique({ where: { id: fileId } });
    if (!file || file.ownerUserId !== userId) throw AppError.notFound('Файл не найден');
    if (file.status === 'ready') throw AppError.conflict('Файл уже загружен');
    if (file.status === 'deleted') throw AppError.notFound('Файл не найден');
    return file;
  }

  /**
   * Уборка: незавершённые загрузки старше суток и объекты, удалённые
   * более 30 дней назад.
   */
  async cleanup(): Promise<{ abandoned: number; purged: number }> {
    const dayAgo = new Date(Date.now() - 86_400_000);
    const abandonedFiles = await this.prisma.storedFile.findMany({
      where: { status: 'pending', createdAt: { lt: dayAgo } },
      take: 500,
    });
    for (const file of abandonedFiles) {
      if (file.uploadId) {
        await this.storage
          .abortMultipartUpload(file.storageKey, file.uploadId)
          .catch(() => undefined);
      }
      await this.storage.delete(file.storageKey).catch(() => undefined);
    }
    if (abandonedFiles.length > 0) {
      await this.prisma.storedFile.deleteMany({
        where: { id: { in: abandonedFiles.map((f) => f.id) } },
      });
    }

    const monthAgo = new Date(Date.now() - 30 * 86_400_000);
    const purgeable = await this.prisma.storedFile.findMany({
      where: { status: 'deleted', deletedAt: { lt: monthAgo } },
      take: 500,
    });
    for (const file of purgeable) {
      const variants = Object.values((file.variants ?? {}) as Record<string, string>);
      for (const key of [file.storageKey, ...variants]) {
        await this.storage.delete(key).catch(() => undefined);
      }
    }
    if (purgeable.length > 0) {
      await this.prisma.storedFile.deleteMany({
        where: { id: { in: purgeable.map((f) => f.id) } },
      });
    }

    return { abandoned: abandonedFiles.length, purged: purgeable.length };
  }

  /** Объём хранилища мастерской — для предупреждения владельцу и админу. */
  async workspaceUsageBytes(workspaceId: string): Promise<number> {
    const result = await this.prisma.storedFile.aggregate({
      where: { workspaceId, deletedAt: null },
      _sum: { sizeBytes: true },
    });
    return Number(result._sum.sizeBytes ?? 0);
  }
}
