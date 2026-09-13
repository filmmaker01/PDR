import { Injectable, Logger } from '@nestjs/common';
import { JobHandler } from '@/infra/jobs/job-handler';
import { JOB } from '@/infra/jobs/job-queue';
import { BackupService } from '../backup.service';

/**
 * Ежедневная проверка резервных копий. Молчаливо пропавший бэкап опаснее
 * упавшей задачи, поэтому просрочка попадает в лог ошибок и в дашборд.
 */
@Injectable()
export class BackupVerifyHandler extends JobHandler<typeof JOB.backupVerify> {
  readonly jobName = JOB.backupVerify;
  override readonly cron = '0 6 * * *';
  private readonly logger = new Logger(BackupVerifyHandler.name);

  constructor(private readonly backups: BackupService) {
    super();
  }

  async handle(): Promise<void> {
    const report = await this.backups.report();
    await this.backups.prune();

    if (report.stale) {
      this.logger.error(
        { last: report.last, ageHours: report.ageHours },
        'Свежей резервной копии нет',
      );
      return;
    }
    this.logger.log({ ageHours: report.ageHours }, 'Резервная копия свежая');
  }
}
