import { Injectable } from '@nestjs/common';
import type { BackupRun } from '@prisma/client';
import { PrismaService } from '@/infra/prisma/prisma.service';

/** Резервная копия считается просроченной, если её нет больше полутора суток. */
export const BACKUP_STALE_HOURS = 36;

export interface BackupReport {
  last: { label: string; objectKey: string; sizeBytes: number; createdAt: string } | null;
  ageHours: number | null;
  stale: boolean;
  /** Сколько копий записано за последнюю неделю. */
  lastWeekCount: number;
}

/**
 * Отчёт о резервных копиях.
 *
 * Скрипт `infra/backup/backup.sh` после успешной загрузки дампа записывает
 * строку в `backup_runs`, поэтому приложение знает о копиях, не имея доступа
 * к хранилищу бэкапов.
 */
@Injectable()
export class BackupService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: { label: string; objectKey: string; sizeBytes: number }): Promise<BackupRun> {
    return this.prisma.backupRun.create({
      data: {
        label: input.label,
        objectKey: input.objectKey,
        sizeBytes: BigInt(input.sizeBytes),
      },
    });
  }

  async report(now = new Date()): Promise<BackupReport> {
    const [last, lastWeekCount] = await Promise.all([
      this.prisma.backupRun.findFirst({ orderBy: { createdAt: 'desc' } }),
      this.prisma.backupRun.count({
        where: { createdAt: { gte: new Date(now.getTime() - 7 * 86_400_000) } },
      }),
    ]);

    if (!last) return { last: null, ageHours: null, stale: true, lastWeekCount };

    const ageHours = (now.getTime() - last.createdAt.getTime()) / 3_600_000;
    return {
      last: {
        label: last.label,
        objectKey: last.objectKey,
        sizeBytes: Number(last.sizeBytes),
        createdAt: last.createdAt.toISOString(),
      },
      ageHours: Math.round(ageHours * 10) / 10,
      stale: ageHours > BACKUP_STALE_HOURS,
      lastWeekCount,
    };
  }

  /** Записи о копиях старше 180 дней не нужны: сами копии уже удалены. */
  async prune(now = new Date()): Promise<number> {
    const result = await this.prisma.backupRun.deleteMany({
      where: { createdAt: { lt: new Date(now.getTime() - 180 * 86_400_000) } },
    });
    return result.count;
  }
}
