import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import { hostname } from 'node:os';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { JobHandler } from './job-handler';
import { JobsService } from './jobs.service';

const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * Worker: тот же AppModule без HTTP-слоя.
 * Находит все JobHandler и подписывает их на очереди, ведёт heartbeat.
 */
@Injectable()
export class WorkerService implements OnModuleInit {
  private readonly logger = new Logger(WorkerService.name);
  private readonly workerId = `${hostname()}-${process.pid}`;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly jobs: JobsService,
    private readonly prisma: PrismaService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (process.env.WORKER_ROLE !== 'true') return;
    await this.startWorker();
  }

  private collectHandlers(): JobHandler[] {
    return this.discovery
      .getProviders()
      .map((w) => w.instance)
      .filter((i): i is JobHandler => i instanceof JobHandler);
  }

  async startWorker(): Promise<void> {
    const handlers = this.collectHandlers();
    for (const handler of handlers) {
      await this.jobs.work(
        handler.jobName,
        async (payload, jobId) => {
          const started = Date.now();
          try {
            await handler.handle(payload as never, jobId);
            this.logger.log(
              { job: handler.jobName, jobId, ms: Date.now() - started },
              'Задача выполнена',
            );
          } catch (err) {
            this.logger.error({ job: handler.jobName, jobId, err }, 'Задача завершилась ошибкой');
            throw err;
          }
        },
        { batchSize: handler.batchSize ?? 1 },
      );
      if (handler.cron) {
        await this.jobs.schedule(handler.jobName, handler.cron);
        this.logger.log(`Расписание ${handler.jobName}: ${handler.cron}`);
      }
    }
    this.logger.log(`Worker запущен, обработчиков: ${handlers.length}`);
    await this.beat();
    this.timer = setInterval(() => void this.beat(), HEARTBEAT_INTERVAL_MS);
    this.timer.unref();
  }

  private async beat(): Promise<void> {
    try {
      await this.prisma.workerHeartbeat.upsert({
        where: { workerId: this.workerId },
        create: {
          workerId: this.workerId,
          lastBeatAt: new Date(),
          version: process.env.APP_VERSION ?? 'dev',
        },
        update: { lastBeatAt: new Date(), version: process.env.APP_VERSION ?? 'dev' },
      });
    } catch (err) {
      this.logger.warn({ err }, 'Не удалось записать heartbeat');
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
