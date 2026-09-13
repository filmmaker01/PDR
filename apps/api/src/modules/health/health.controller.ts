import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppConfigService } from '@/config/config.service';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { JobsService } from '@/infra/jobs/jobs.service';
import { Public } from '@/modules/auth/decorators/auth.decorators';

interface ReadyCheck {
  status: 'ok' | 'degraded';
  checks: Record<string, { ok: boolean; error?: string }>;
  version: string;
  appEnv: string;
}

@ApiTags('health')
@Public()
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly config: AppConfigService,
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Liveness: процесс жив' })
  live(): { status: 'ok'; uptime: number } {
    return { status: 'ok', uptime: Math.round(process.uptime()) };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness: база, очередь' })
  async ready(): Promise<ReadyCheck> {
    const checks: ReadyCheck['checks'] = {};

    try {
      await this.prisma.ping();
      checks.database = { ok: true };
    } catch (e) {
      checks.database = { ok: false, error: (e as Error).message };
    }

    checks.queue = this.jobs.isEnabled
      ? { ok: true }
      : { ok: this.config.isTest, error: this.config.isTest ? undefined : 'queue not started' };

    const ok = Object.values(checks).every((c) => c.ok);
    return {
      status: ok ? 'ok' : 'degraded',
      checks,
      version: process.env.APP_VERSION ?? 'dev',
      appEnv: this.config.env.APP_ENV,
    };
  }
}
