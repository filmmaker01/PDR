import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { PlatformRoles } from '@/modules/auth/decorators/auth.decorators';
import { NotificationsService } from '@/modules/notifications/notifications.service';
import { JobsService } from '@/infra/jobs/jobs.service';

const WORKER_STALE_MS = 120_000;

@ApiTags('admin')
@Controller('admin/dashboard')
@PlatformRoles('admin')
export class AdminDashboardController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly jobs: JobsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Сводка состояния платформы' })
  async get() {
    const weekAhead = new Date(Date.now() + 7 * 86_400_000);

    const [users, workspaces, activeGrants, expiringGrants, heartbeats, failedNotifications] =
      await Promise.all([
        this.prisma.user.count(),
        this.prisma.workspace.count({ where: { archivedAt: null } }),
        this.prisma.accessGrant.count({ where: { status: 'active' } }),
        this.prisma.accessGrant.count({
          where: { status: 'active', validUntil: { not: null, lte: weekAhead } },
        }),
        this.prisma.workerHeartbeat.findMany({ orderBy: { lastBeatAt: 'desc' }, take: 5 }),
        this.prisma.notification.count({ where: { status: 'failed' } }),
      ]);

    const lastBeat = heartbeats[0]?.lastBeatAt ?? null;
    const workerAlive = lastBeat !== null && Date.now() - lastBeat.getTime() < WORKER_STALE_MS;

    return {
      users,
      workspaces,
      grants: { active: activeGrants, expiringInWeek: expiringGrants },
      notifications: { ...(await this.notifications.stats()), failedTotal: failedNotifications },
      worker: {
        alive: workerAlive,
        lastBeatAt: lastBeat?.toISOString() ?? null,
        instances: heartbeats.length,
      },
      queue: { enabled: this.jobs.isEnabled },
      // Учебные и CRM-показатели добавляются на этапах 6–13.
    };
  }
}
