import { Injectable } from '@nestjs/common';
import { JobHandler } from '@/infra/jobs/job-handler';
import { JOB } from '@/infra/jobs/job-queue';
import { ExamsService } from '../exams.service';

/**
 * Закрытие попыток с истёкшим временем.
 * Тест проверяется по тому, что успел ответить ученик: потеря ответов
 * из-за закрытой вкладки была бы несправедливой.
 */
@Injectable()
export class ExpireAttemptsHandler extends JobHandler<typeof JOB.examsExpireAttempts> {
  readonly jobName = JOB.examsExpireAttempts;
  override readonly cron = '*/5 * * * *';

  constructor(private readonly exams: ExamsService) {
    super();
  }

  async handle(): Promise<void> {
    await this.exams.expireOverdue();
  }
}
