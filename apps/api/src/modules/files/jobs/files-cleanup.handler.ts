import { Injectable, Logger } from '@nestjs/common';
import { JobHandler } from '@/infra/jobs/job-handler';
import { JOB } from '@/infra/jobs/job-queue';
import { FilesService } from '../files.service';

/** Ежедневная уборка: брошенные загрузки и удалённые файлы старше 30 дней. */
@Injectable()
export class FilesCleanupHandler extends JobHandler<typeof JOB.filesCleanup> {
  readonly jobName = JOB.filesCleanup;
  override readonly cron = '45 3 * * *';
  private readonly logger = new Logger(FilesCleanupHandler.name);

  constructor(private readonly files: FilesService) {
    super();
  }

  async handle(): Promise<void> {
    const result = await this.files.cleanup();
    this.logger.log(
      `Удалено брошенных загрузок: ${result.abandoned}, окончательно стёрто файлов: ${result.purged}`,
    );
  }
}
