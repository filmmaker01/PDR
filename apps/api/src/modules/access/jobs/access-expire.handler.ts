import { Injectable, Logger } from '@nestjs/common';
import { JobHandler } from '@/infra/jobs/job-handler';
import { JOB } from '@/infra/jobs/job-queue';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { NotificationsService } from '@/modules/notifications/notifications.service';
import { AccessService } from '../access.service';

const PRODUCT_LABELS: Record<string, string> = {
  course: 'Доступ к курсу',
  crm: 'Доступ к CRM мастерской',
  club: 'Доступ к закрытому клубу',
};

const WARN_DAYS = [7, 1];

/**
 * Ежечасная задача по доступам: перевод просроченных в expired
 * и предупреждения за 7 и 1 день до окончания.
 *
 * Проверка «доступ действует» в guard'ах не полагается на эту задачу:
 * она сравнивает даты сама. Задача нужна для следствий (клуб, уведомления)
 * и честного статуса в админке.
 */
@Injectable()
export class AccessExpireHandler extends JobHandler<typeof JOB.accessExpire> {
  readonly jobName = JOB.accessExpire;
  override readonly cron = '5 * * * *';
  private readonly logger = new Logger(AccessExpireHandler.name);

  constructor(
    private readonly access: AccessService,
    private readonly notifications: NotificationsService,
    private readonly prisma: PrismaService,
  ) {
    super();
  }

  async handle(): Promise<void> {
    await this.expire();
    await this.warn();
  }

  private async expire(): Promise<void> {
    const expired = await this.access.expireOutdated();
    if (expired.length === 0) return;

    const byProduct = expired.reduce<Record<string, number>>((acc, grant) => {
      acc[grant.product] = (acc[grant.product] ?? 0) + 1;
      return acc;
    }, {});
    this.logger.log(`Истекли доступы: ${JSON.stringify(byProduct)}`);
    // Удаление из клуба подключается на этапе 14.
  }

  private async warn(): Promise<void> {
    let queued = 0;

    for (const days of WARN_DAYS) {
      const from = new Date(Date.now() + (days - 1) * 86_400_000);
      const to = new Date(Date.now() + days * 86_400_000);
      const grants = await this.access.findExpiringBetween(from, to);

      for (const grant of grants) {
        const recipients = grant.userId ? [grant.userId] : await this.ownersOf(grant.workspaceId);

        for (const userId of recipients) {
          const created = await this.notifications.notify({
            userId,
            type: 'access_expiring',
            payload: {
              daysLeft: days,
              productLabel: PRODUCT_LABELS[grant.product] ?? 'Доступ',
              validUntil: grant.validUntil?.toISOString(),
            },
            dedupeKey: `access_expiring:${grant.id}:${days}`,
          });
          if (created) queued += 1;
        }
      }
    }

    if (queued > 0) this.logger.log(`Поставлено предупреждений об истечении: ${queued}`);
  }

  private async ownersOf(workspaceId: string | null): Promise<string[]> {
    if (!workspaceId) return [];
    const owners = await this.prisma.workspaceMember.findMany({
      where: { workspaceId, role: 'owner', isActive: true },
      select: { userId: true },
    });
    return owners.map((o) => o.userId);
  }
}
