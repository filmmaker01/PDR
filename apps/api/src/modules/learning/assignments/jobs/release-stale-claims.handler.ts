import { Injectable } from '@nestjs/common';
import { JobHandler } from '@/infra/jobs/job-handler';
import { JOB } from '@/infra/jobs/job-queue';
import { ReviewsService } from '../reviews.service';

/** Куратор мог закрыть приложение, не приняв решения: возвращаем работу в очередь. */
@Injectable()
export class ReleaseStaleClaimsHandler extends JobHandler<
  typeof JOB.submissionsReleaseStaleClaims
> {
  readonly jobName = JOB.submissionsReleaseStaleClaims;
  override readonly cron = '*/10 * * * *';

  constructor(private readonly reviews: ReviewsService) {
    super();
  }

  async handle(): Promise<void> {
    await this.reviews.releaseStaleClaims();
  }
}
