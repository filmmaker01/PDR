import { Injectable, Logger } from '@nestjs/common';
import { JobHandler } from '@/infra/jobs/job-handler';
import { JOB } from '@/infra/jobs/job-queue';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { AuthService } from '../auth.service';
import { SessionService } from '../session.service';

/** Ежедневная чистка: просроченные сессии, запросы входа, ключи идемпотентности. */
@Injectable()
export class SessionsCleanupHandler extends JobHandler<typeof JOB.sessionsCleanup> {
  readonly jobName = JOB.sessionsCleanup;
  override readonly cron = '15 3 * * *';
  private readonly logger = new Logger(SessionsCleanupHandler.name);

  constructor(
    private readonly sessions: SessionService,
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
  ) {
    super();
  }

  async handle(): Promise<void> {
    const sessions = await this.sessions.cleanupExpired();
    const logins = await this.auth.cleanupLoginRequests();
    const updates = await this.prisma.telegramUpdate.deleteMany({
      where: { createdAt: { lt: new Date(Date.now() - 86_400_000) } },
    });
    this.logger.log(
      `Удалено: сессий ${sessions}, запросов входа ${logins}, обновлений Telegram ${updates.count}`,
    );
  }
}
