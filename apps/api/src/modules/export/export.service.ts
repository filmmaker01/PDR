import { Injectable, Logger } from '@nestjs/common';
import type { Export, ExportKind, User } from '@prisma/client';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { AppError } from '@/common/errors/app.error';
import { JobsService } from '@/infra/jobs/jobs.service';
import { JOB } from '@/infra/jobs/job-queue';
import { FilesService } from '@/modules/files/files.service';
import { NotificationsService } from '@/modules/notifications/notifications.service';
import { ExportBuilderService } from './export-builder.service';

/** Выгрузки старше этого срока удаляются: ссылка не должна жить вечно. */
export const EXPORT_TTL_DAYS = 7;

const CRM_KINDS: ExportKind[] = ['crm_full', 'crm_clients', 'crm_orders', 'crm_payments'];
const ADMIN_KINDS: ExportKind[] = ['learning_students', 'learning_progress', 'audit'];

@Injectable()
export class ExportService {
  private readonly logger = new Logger(ExportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly builder: ExportBuilderService,
    private readonly files: FilesService,
    private readonly notifications: NotificationsService,
  ) {}

  isCrmKind(kind: ExportKind): boolean {
    return CRM_KINDS.includes(kind);
  }

  isAdminKind(kind: ExportKind): boolean {
    return ADMIN_KINDS.includes(kind);
  }

  async request(input: {
    kind: ExportKind;
    requestedById: string;
    workspaceId?: string | null;
    params?: Record<string, unknown>;
  }): Promise<Export> {
    if (this.isCrmKind(input.kind) && !input.workspaceId) {
      throw AppError.validation('Для выгрузки CRM нужна мастерская');
    }

    // Одна выгрузка в работе на заказчика: повторные нажатия не плодят задачи.
    const running = await this.prisma.export.findFirst({
      where: {
        requestedById: input.requestedById,
        status: { in: ['queued', 'running'] },
      },
    });
    if (running) {
      throw new AppError('conflict', 'Предыдущая выгрузка ещё готовится', {
        exportId: running.id,
      });
    }

    const created = await this.prisma.export.create({
      data: {
        kind: input.kind,
        requestedById: input.requestedById,
        workspaceId: input.workspaceId ?? null,
        params: (input.params ?? {}) as object,
        status: 'queued',
      },
    });

    await this.jobs.enqueue(
      JOB.exportRun,
      { exportId: created.id },
      { singletonKey: `export:${created.id}`, retryLimit: 2 },
    );
    return created;
  }

  /** Сборка выгрузки. Вызывается задачей очереди. */
  async run(exportId: string): Promise<void> {
    const record = await this.prisma.export.findUnique({ where: { id: exportId } });
    if (!record) return;
    if (record.status === 'done') return;

    await this.prisma.export.update({
      where: { id: exportId },
      data: { status: 'running' },
    });

    try {
      const built = await this.builder.build({
        kind: record.kind,
        workspaceId: record.workspaceId,
        params: (record.params ?? {}) as Record<string, unknown>,
      });

      const file = await this.files.storeGenerated({
        ownerUserId: record.requestedById,
        workspaceId: record.workspaceId,
        scope: 'export',
        body: built.body,
        mimeType: built.contentType,
        originalName: built.fileName,
      });

      await this.prisma.export.update({
        where: { id: exportId },
        data: {
          status: 'done',
          fileId: file.id,
          rowCount: built.rowCount,
          finishedAt: new Date(),
          error: null,
        },
      });

      await this.notifications.notify({
        userId: record.requestedById,
        type: 'export_ready',
        payload: { exportId, kind: record.kind, rowCount: built.rowCount },
        dedupeKey: `export_ready:${exportId}`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось собрать выгрузку';
      await this.prisma.export.update({
        where: { id: exportId },
        data: { status: 'failed', error: message, finishedAt: new Date() },
      });
      this.logger.error({ err, exportId }, 'Ошибка выгрузки');
      throw err;
    }
  }

  async listFor(requestedById: string, workspaceId?: string | null): Promise<Export[]> {
    return this.prisma.export.findMany({
      where: {
        requestedById,
        ...(workspaceId ? { workspaceId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  }

  async getById(exportId: string, requestedById: string): Promise<Export> {
    const record = await this.prisma.export.findFirst({
      where: { id: exportId, requestedById },
    });
    if (!record) throw AppError.notFound('Выгрузка не найдена');
    return record;
  }

  /** Ссылка на скачивание готовой выгрузки. */
  async downloadUrl(
    exportId: string,
    user: User,
    platformRoles: string[],
  ): Promise<{ url: string; expiresAt: string; fileName: string }> {
    const record = await this.getById(exportId, user.id);
    if (record.status !== 'done' || !record.fileId) {
      throw new AppError('file_not_ready', 'Выгрузка ещё не готова');
    }
    const link = await this.files.downloadUrl(record.fileId, user, platformRoles, 'original');
    const file = await this.files.getById(record.fileId);
    return { ...link, fileName: file.originalName ?? 'export' };
  }

  /** Удаление устаревших выгрузок вместе с файлами. */
  async cleanup(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - EXPORT_TTL_DAYS * 86_400_000);
    const stale = await this.prisma.export.findMany({
      where: { createdAt: { lt: cutoff } },
      select: { id: true, fileId: true },
    });
    if (stale.length === 0) return 0;

    const fileIds = stale.map((item) => item.fileId).filter((id): id is string => Boolean(id));
    if (fileIds.length > 0) {
      await this.prisma.storedFile.updateMany({
        where: { id: { in: fileIds } },
        data: { status: 'deleted', deletedAt: now },
      });
    }
    await this.prisma.export.deleteMany({ where: { id: { in: stale.map((item) => item.id) } } });
    return stale.length;
  }
}
