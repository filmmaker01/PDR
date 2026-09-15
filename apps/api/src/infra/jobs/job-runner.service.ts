import { Injectable, Logger } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import { hostname } from 'node:os';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { cronMatches, minuteKey } from './cron-match';
import { JobHandler } from './job-handler';
import { JobsService } from './jobs.service';

/**
 * Сколько задача может числиться выполняющейся, прежде чем её вернут в очередь.
 * Функция может быть прервана по таймауту, и тогда результат никто не проставит.
 */
const STALE_ACTIVE_SEC = 15 * 60;

/** Сколько задач берётся за один заход. */
const BATCH_SIZE = 10;

/**
 * Разбор очереди фоновых задач.
 *
 * Раньше это был постоянный процесс: pg-boss сам опрашивал базу и звал
 * обработчики. На Vercel постоянного процесса нет, поэтому очередь разбирает
 * cron-эндпоинт, вызывающий `tick()` раз в минуту.
 *
 * Сами обработчики не изменились: они по-прежнему находятся через
 * DiscoveryService, поэтому бизнес-логика задач осталась прежней.
 */
@Injectable()
export class JobRunnerService {
  private readonly logger = new Logger(JobRunnerService.name);
  private readonly workerId = `${hostname()}-${process.pid}`;

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly jobs: JobsService,
    private readonly prisma: PrismaService,
  ) {}

  private collectHandlers(): JobHandler[] {
    return this.discovery
      .getProviders()
      .map((w) => w.instance)
      .filter((i): i is JobHandler => i instanceof JobHandler);
  }

  /**
   * Один заход: вернуть зависшее, поставить задачи по расписанию и выполнить
   * то, что готово.
   *
   * @param budgetMs сколько времени отведено на выполнение задач. Нужен, чтобы
   * уложиться в таймаут функции: недоделанное останется в очереди и будет взято
   * следующим заходом.
   */
  async tick(budgetMs: number): Promise<{
    scheduled: number;
    processed: number;
    failed: number;
    requeued: number;
  }> {
    const deadline = Date.now() + budgetMs;

    const requeued = await this.jobs.requeueStale(STALE_ACTIVE_SEC);
    if (requeued > 0) this.logger.warn({ requeued }, 'Зависшие задачи возвращены в очередь');

    const scheduled = await this.enqueueDue(new Date());
    const { processed, failed } = await this.drain(deadline);

    await this.beat();
    return { scheduled, processed, failed, requeued };
  }

  /**
   * Поставить в очередь задачи, у которых расписание попадает на эту минуту.
   *
   * Ключ уникальности содержит минуту, поэтому повторный вызов в ту же минуту
   * (перезапуск cron, параллельный вызов) не создаёт дубль.
   */
  async enqueueDue(now: Date): Promise<number> {
    const key = minuteKey(now);
    let scheduled = 0;

    for (const handler of this.collectHandlers()) {
      if (!handler.cron) continue;
      if (!cronMatches(handler.cron, now)) continue;

      const id = await this.jobs.enqueue(handler.jobName, {} as never, {
        singletonKey: `cron:${handler.jobName}:${key}`,
      });
      if (id) {
        scheduled += 1;
        this.logger.log({ job: handler.jobName, cron: handler.cron }, 'Задача по расписанию');
      }
    }

    return scheduled;
  }

  /** Выполнять готовые задачи, пока они есть и не вышло отведённое время. */
  private async drain(deadline: number): Promise<{ processed: number; failed: number }> {
    const handlers = new Map(this.collectHandlers().map((h) => [h.jobName, h]));
    let processed = 0;
    let failed = 0;

    while (Date.now() < deadline) {
      const batch = await this.jobs.claim(BATCH_SIZE);
      if (batch.length === 0) break;

      for (const job of batch) {
        const handler = handlers.get(job.name);

        if (!handler) {
          // Обработчик мог быть удалён вместе с кодом: держать такую задачу
          // в очереди бессмысленно.
          this.logger.error({ job: job.name, jobId: job.id }, 'Нет обработчика для задачи');
          await this.jobs.fail(
            { ...job, attempts: job.retryLimit },
            new Error(`Нет обработчика ${job.name}`),
          );
          failed += 1;
          continue;
        }

        const started = Date.now();
        try {
          await handler.handle(job.payload as never, job.id);
          await this.jobs.complete(job.id);
          processed += 1;
          this.logger.log(
            { job: job.name, jobId: job.id, ms: Date.now() - started },
            'Задача выполнена',
          );
        } catch (err) {
          await this.jobs.fail(job, err);
          failed += 1;
          this.logger.error({ job: job.name, jobId: job.id, err }, 'Задача завершилась ошибкой');
        }

        if (Date.now() >= deadline) break;
      }
    }

    return { processed, failed };
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
}
