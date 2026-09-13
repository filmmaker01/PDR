import { Injectable, Logger } from '@nestjs/common';
import { JobHandler } from '@/infra/jobs/job-handler';
import { JOB, type JobPayloads } from '@/infra/jobs/job-queue';
import { ClubService } from '../club.service';

/** Решение по заявке в клуб: одобрить при действующем доступе, иначе отклонить. */
@Injectable()
export class ClubApproveHandler extends JobHandler<typeof JOB.clubApprove> {
  readonly jobName = JOB.clubApprove;
  private readonly logger = new Logger(ClubApproveHandler.name);

  constructor(private readonly club: ClubService) {
    super();
  }

  async handle(payload: JobPayloads[typeof JOB.clubApprove]): Promise<void> {
    await this.club.processJoinRequest(payload.userId, payload.telegramUserId);
    this.logger.log({ userId: payload.userId }, 'Заявка в клуб обработана');
  }
}
