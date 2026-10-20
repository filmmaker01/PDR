import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import { waitUntil } from '@vercel/functions';
import { hostname } from 'node:os';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { latestCronMatch, minuteKey } from './cron-match';
import { JobHandler } from './job-handler';
import { CRON_KEY_PREFIX, JobsService } from './jobs.service';

/**
 * Сколько задача может числиться выполняющейся, прежде чем её вернут в очередь.
 * Функция может быть прервана по таймауту, и тогда результат никто не проставит.
 */
const STALE_ACTIVE_SEC = 15 * 60;

/** Сколько задач берётся за один заход. */
const BATCH_SIZE = 10;

/**
 * Насколько далеко назад ищется пропущенный запуск по расписанию.
 * Ограничивает и перебор минут, и разовую «догонялку» после долгого простоя
 * (или для задачи, которая ещё ни разу не запускалась).
 */
const MAX_CATCH_UP_MS = 24 * 60 * 60 * 1000;

/**
 * Пауза перед разбором очереди после запроса. Задачу часто ставят рядом
 * с транзакцией, которая создаёт её данные: пусть та успеет завершиться.
 */
const AFTER_REQUEST_DELAY_MS = 1_000;

/** Сколько времени разбирается очередь после запроса. */
const AFTER_REQUEST_BUDGET_MS = 30_000;

/**
 * Разбор очереди фоновых задач.
 *
 * Раньше это был постоянный процесс: pg-boss сам опрашивал базу и звал
 * обработчики. На Vercel постоянного процесса нет, поэтому очередь разбирают:
 * - cron-эндпоинт, вызывающий `tick()` раз в 15 минут. Чаще нельзя: каждый
 *   вызов будит базу, и при ежеминутном вызове она не засыпала вовсе,
 *   из-за чего за месяц кончилась квота Neon;
 * - сама функция сразу после запроса, поставившего задачу к немедленному
 *   выполнению (`waitUntil`): уведомление или экспорт не ждут cron.
 *
 * Сами обработчики не изменились: они по-прежнему находятся через
 * DiscoveryService, поэтому бизнес-логика задач осталась прежней.
 */
@Injectable()
export class JobRunnerService implements OnModuleInit {
  private readonly logger = new Logger(JobRunnerService.name);
  private readonly workerId = `${hostname()}-${process.pid}`;

  /** Разбор очереди уже идёт или запланирован в этом экземпляре функции. */
  private busy = false;
  /** Пока шёл разбор, появились новые готовые задачи. */
  private readyAgain = false;

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly jobs: JobsService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit(): void {
    // Локально очередь разбирает worker.ts в цикле, разбор после запроса нужен
    // только на Vercel.
    if (process.env.VERCEL) this.jobs.onReady(() => this.drainAfterRequest());
  }

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
    // Задачи по расписанию тоже готовы сразу; разбирать их второй раз
    // после запроса не нужно — этим займётся сам tick.
    const wasBusy = this.busy;
    this.busy = true;

    try {
      const requeued = await this.jobs.requeueStale(STALE_ACTIVE_SEC);
      if (requeued > 0) this.logger.warn({ requeued }, 'Зависшие задачи возвращены в очередь');

      const scheduled = await this.enqueueDue(new Date());
      const { processed, failed } = await this.drain(deadline);

      await this.beat();
      return { scheduled, processed, failed, requeued };
    } finally {
      this.busy = wasBusy;
      // Задача могла появиться, когда разбор уже закончился, а флаг ещё стоял.
      if (!wasBusy && this.readyAgain && process.env.VERCEL) this.drainAfterRequest();
    }
  }

  /**
   * Поставить в очередь задачи, чьё расписание наступило с прошлого запуска.
   *
   * Cron вызывает разбор реже, чем раз в минуту, поэтому минута вызова почти
   * никогда не совпадает с минутой расписания. Для каждой задачи ищется
   * последняя минута расписания после её прошлого запуска (но не дальше
   * `MAX_CATCH_UP_MS`); несколько пропущенных запусков сливаются в один —
   * задачи по расписанию обрабатывают всё накопившееся.
   *
   * Ключ уникальности содержит минуту расписания, поэтому повторный или
   * параллельный вызов не создаёт дубль, пока задача ждёт, а после выполнения
   * её минута уже стала «прошлым запуском».
   */
  async enqueueDue(now: Date): Promise<number> {
    const handlers = this.collectHandlers().filter((h) => h.cron);
    if (handlers.length === 0) return 0;

    const lastRuns = await this.jobs.lastCronRuns();
    const horizon = new Date(now.getTime() - MAX_CATCH_UP_MS);
    let scheduled = 0;

    for (const handler of handlers) {
      const last = lastRuns.get(handler.jobName);
      const after = last && last > horizon ? last : horizon;
      const due = latestCronMatch(handler.cron as string, after, now);
      if (!due) continue;

      const id = await this.jobs.enqueue(handler.jobName, {} as never, {
        singletonKey: `${CRON_KEY_PREFIX}${handler.jobName}:${minuteKey(due)}`,
      });
      if (id) {
        scheduled += 1;
        this.logger.log(
          { job: handler.jobName, cron: handler.cron, due: due.toISOString() },
          'Задача по расписанию',
        );
      }
    }

    return scheduled;
  }

  /**
   * Разобрать очередь после текущего запроса, не дожидаясь cron.
   *
   * `waitUntil` держит функцию живой после ответа. Повторные вызовы в одном
   * запросе (или пока разбор идёт) не плодят параллельных разборов: идущий
   * разбор просто сделает ещё один круг.
   */
  private drainAfterRequest(): void {
    if (this.busy) {
      this.readyAgain = true;
      return;
    }
    this.busy = true;

    const run = async (): Promise<void> => {
      await new Promise((resolve) => setTimeout(resolve, AFTER_REQUEST_DELAY_MS));
      do {
        this.readyAgain = false;
        await this.drain(Date.now() + AFTER_REQUEST_BUDGET_MS);
      } while (this.readyAgain);
    };

    waitUntil(
      run()
        .catch((err: unknown) => this.logger.error({ err }, 'Ошибка разбора очереди после запроса'))
        .finally(() => {
          this.busy = false;
          if (this.readyAgain) this.drainAfterRequest();
        }),
    );
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
