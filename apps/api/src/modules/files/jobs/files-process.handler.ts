import { Injectable } from '@nestjs/common';
import { JobHandler } from '@/infra/jobs/job-handler';
import { JOB } from '@/infra/jobs/job-queue';
import { FilesService } from '../files.service';

/** Проверка сигнатуры, размеры, миниатюры. Повторяется при сбое. */
@Injectable()
export class FilesProcessHandler extends JobHandler<typeof JOB.filesProcess> {
  readonly jobName = JOB.filesProcess;
  override readonly batchSize = 2;

  constructor(private readonly files: FilesService) {
    super();
  }

  async handle(payload: { fileId: string }): Promise<void> {
    await this.files.process(payload.fileId);
  }
}
