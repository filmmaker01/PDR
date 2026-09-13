import { Injectable, Logger } from '@nestjs/common';
import { JobHandler } from '@/infra/jobs/job-handler';
import { JOB, type JobPayloads } from '@/infra/jobs/job-queue';
import { ClubService } from '../club.service';

/** Исключение из клуба после отзыва или истечения доступа. */
@Injectable()
export class ClubRemoveHandler extends JobHandler<typeof JOB.clubRemove> {
  readonly jobName = JOB.clubRemove;
  private readonly logger = new Logger(ClubRemoveHandler.name);

  constructor(private readonly club: ClubService) {
    super();
  }

  async handle(payload: JobPayloads[typeof JOB.clubRemove]): Promise<void> {
    await this.club.removeMember(payload.userId, payload.reason);
    this.logger.log({ userId: payload.userId }, 'Пользователь исключён из клуба');
  }
}
