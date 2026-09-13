import { Injectable, Logger } from '@nestjs/common';
import { JobHandler } from '@/infra/jobs/job-handler';
import { JOB } from '@/infra/jobs/job-queue';
import { ClubService } from '../club.service';

/**
 * Ежедневная сверка клуба. Bot API не позволяет перечислить участников группы,
 * поэтому отчёт строится от нашей базы: для каждого известного участника
 * проверяется доступ и фактический статус в Telegram.
 */
@Injectable()
export class ClubAuditHandler extends JobHandler<typeof JOB.clubAudit> {
  readonly jobName = JOB.clubAudit;
  override readonly cron = '30 3 * * *';
  private readonly logger = new Logger(ClubAuditHandler.name);

  constructor(private readonly club: ClubService) {
    super();
  }

  async handle(): Promise<void> {
    const result = await this.club.audit();
    if (result.removed > 0 || result.fixed > 0) {
      this.logger.log(result, 'Сверка клуба завершена');
    }
  }
}
