import { Injectable, Logger } from '@nestjs/common';
import { JobHandler } from '@/infra/jobs/job-handler';
import { JOB } from '@/infra/jobs/job-queue';
import { AccessService } from '../access.service';

/**
 * Ежечасный перевод просроченных доступов в expired.
 * Проверка «доступ действует» в guard'ах не полагается на эту задачу:
 * она сравнивает даты сама, а задача нужна для следствий (клуб, уведомления)
 * и для честного статуса в админке.
 */
@Injectable()
export class AccessExpireHandler extends JobHandler<typeof JOB.accessExpire> {
  readonly jobName = JOB.accessExpire;
  override readonly cron = '5 * * * *';
  private readonly logger = new Logger(AccessExpireHandler.name);

  constructor(private readonly access: AccessService) {
    super();
  }

  async handle(): Promise<void> {
    const expired = await this.access.expireOutdated();
    if (expired.length === 0) return;

    const byProduct = expired.reduce<Record<string, number>>((acc, grant) => {
      acc[grant.product] = (acc[grant.product] ?? 0) + 1;
      return acc;
    }, {});
    this.logger.log(`Истекли доступы: ${JSON.stringify(byProduct)}`);
    // Следствия по клубу подключаются на этапе 14, уведомления — на этапе 4.
  }
}
