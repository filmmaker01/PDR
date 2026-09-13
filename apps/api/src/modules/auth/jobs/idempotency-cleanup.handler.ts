import { Injectable, Logger } from '@nestjs/common';
import { JobHandler } from '@/infra/jobs/job-handler';
import { JOB } from '@/infra/jobs/job-queue';
import { PrismaService } from '@/infra/prisma/prisma.service';

/** Ключи идемпотентности живут сутки: дольше повторов клиента не бывает. */
@Injectable()
export class IdempotencyCleanupHandler extends JobHandler<typeof JOB.idempotencyCleanup> {
  readonly jobName = JOB.idempotencyCleanup;
  override readonly cron = '30 3 * * *';
  private readonly logger = new Logger(IdempotencyCleanupHandler.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async handle(): Promise<void> {
    const result = await this.prisma.idempotencyKey.deleteMany({
      where: { createdAt: { lt: new Date(Date.now() - 86_400_000) } },
    });
    this.logger.log(`Удалено ключей идемпотентности: ${result.count}`);
  }
}
