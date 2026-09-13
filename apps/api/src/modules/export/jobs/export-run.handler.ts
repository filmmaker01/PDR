import { Injectable, Logger } from '@nestjs/common';
import { JobHandler } from '@/infra/jobs/job-handler';
import { JOB, type JobPayloads } from '@/infra/jobs/job-queue';
import { ExportService } from '../export.service';

/** Сборка выгрузки в фоне: большая мастерская собирается дольше запроса. */
@Injectable()
export class ExportRunHandler extends JobHandler<typeof JOB.exportRun> {
  readonly jobName = JOB.exportRun;
  private readonly logger = new Logger(ExportRunHandler.name);

  constructor(private readonly exports: ExportService) {
    super();
  }

  async handle(payload: JobPayloads[typeof JOB.exportRun]): Promise<void> {
    await this.exports.run(payload.exportId);
    this.logger.log({ exportId: payload.exportId }, 'Выгрузка готова');
  }
}
