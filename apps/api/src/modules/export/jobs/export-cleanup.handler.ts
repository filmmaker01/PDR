import { Injectable, Logger } from '@nestjs/common';
import { JobHandler } from '@/infra/jobs/job-handler';
import { JOB } from '@/infra/jobs/job-queue';
import { ExportService } from '../export.service';

/** Выгрузки живут неделю: ссылка на базу клиентов не должна жить вечно. */
@Injectable()
export class ExportCleanupHandler extends JobHandler<typeof JOB.exportCleanup> {
  readonly jobName = JOB.exportCleanup;
  override readonly cron = '20 4 * * *';
  private readonly logger = new Logger(ExportCleanupHandler.name);

  constructor(private readonly exports: ExportService) {
    super();
  }

  async handle(): Promise<void> {
    const removed = await this.exports.cleanup();
    if (removed > 0) this.logger.log(`Удалено устаревших выгрузок: ${removed}`);
  }
}
