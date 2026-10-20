import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppConfigService } from '@/config/config.service';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { parseMinuteKey } from './cron-match';
import { type JobName, type JobPayloads } from './job-queue';

/** Префикс ключа уникальности задач, поставленных по расписанию. */
export const CRON_KEY_PREFIX = 'cron:';

export interface EnqueueOptions {
  /** Задержка перед выполнением, секунды. */
  startAfterSec?: number;
  /** Точное время выполнения. */
  startAfter?: Date;
  /** Ключ уникальности: повторная постановка с тем же ключом не создаёт дубль. */
  singletonKey?: string;
  retryLimit?: number;
  retryDelaySec?: number;
}

/** Задача, взятая из очереди на выполнение. */
export interface ClaimedJob {
  id: string;
  name: JobName;
  payload: unknown;
  attempts: number;
  retryLimit: number;
  retryDelaySec: number;
}

/**
 * Очередь фоновых задач поверх обычной таблицы PostgreSQL.
 *
 * До переезда на Vercel очередь держал pg-boss, но ему нужен постоянный процесс:
 * он опрашивает базу таймерами и держит соединения между запросами. В функциях
 * такого процесса нет, поэтому задачи просто лежат в таблице, а разбирает их
 * cron-эндпоинт (см. `JobRunnerService`).
 *
 * Внешний интерфейс постановки задачи не изменился: вызывающий код в модулях
 * остался прежним.
 */
@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  /**
   * Вызывается, когда поставлена задача, которую можно выполнять сразу.
   * Подписывается `JobRunnerService`: прямая зависимость была бы циклической.
   */
  private readyListener: (() => void) | null = null;

  constructor(
    private readonly config: AppConfigService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * В тестах очередь по умолчанию выключена: задачи не должны выполняться
   * сами по себе и мешать проверкам.
   */
  get isEnabled(): boolean {
    return !this.config.isTest || process.env.JOBS_ENABLED === 'true';
  }

  onReady(listener: () => void): void {
    this.readyListener = listener;
  }

  /** Постановка задачи. Если очередь отключена (тесты) — no-op с записью в лог. */
  async enqueue<N extends JobName>(
    name: N,
    payload: JobPayloads[N],
    options: EnqueueOptions = {},
  ): Promise<string | null> {
    if (!this.isEnabled) {
      this.logger.debug({ name, payload }, 'Очередь отключена, задача пропущена');
      return null;
    }

    const runAt =
      options.startAfter ??
      (options.startAfterSec ? new Date(Date.now() + options.startAfterSec * 1000) : new Date());

    try {
      const job = await this.prisma.jobQueue.create({
        data: {
          name,
          payload: (payload ?? {}) as Prisma.InputJsonValue,
          runAt,
          singletonKey: options.singletonKey ?? null,
          retryLimit: options.retryLimit ?? 3,
          retryDelaySec: options.retryDelaySec ?? 30,
        },
        select: { id: true },
      });
      if (runAt.getTime() <= Date.now()) this.readyListener?.();
      return job.id;
    } catch (err) {
      // Нарушение уникальности ключа означает, что такая задача уже ждёт
      // выполнения. Это штатный исход singletonKey, а не ошибка.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        this.logger.debug({ name, singletonKey: options.singletonKey }, 'Задача уже в очереди');
        return null;
      }
      throw err;
    }
  }

  /**
   * Минута последнего запуска по расписанию для каждой задачи.
   *
   * Отдельной отметки «докуда расписание разобрано» нет: её роль играют сами
   * задачи — ключ уникальности содержит минуту запуска, а ISO-запись минуты
   * сортируется как строка. Завершённые задачи тоже учитываются, иначе
   * выполненный запуск поставился бы повторно.
   */
  async lastCronRuns(): Promise<Map<string, Date>> {
    const rows = await this.prisma.$queryRaw<{ name: string; key: string }[]>(Prisma.sql`
      SELECT "name", MAX("singleton_key") AS "key"
      FROM "job_queue"
      WHERE "singleton_key" LIKE ${`${CRON_KEY_PREFIX}%`}
      GROUP BY "name"
    `);

    const runs = new Map<string, Date>();
    for (const row of rows) {
      const at = parseMinuteKey(row.key.slice(`${CRON_KEY_PREFIX}${row.name}:`.length));
      if (at) runs.set(row.name, at);
    }
    return runs;
  }

  /**
   * Взять из очереди до `limit` готовых задач.
   *
   * `SKIP LOCKED` позволяет нескольким одновременным вызовам tick разбирать
   * очередь параллельно, не дожидаясь друг друга и не выполняя одно дважды.
   */
  async claim(limit: number): Promise<ClaimedJob[]> {
    const rows = await this.prisma.$queryRaw<
      {
        id: string;
        name: string;
        payload: unknown;
        attempts: number;
        retry_limit: number;
        retry_delay_sec: number;
      }[]
    >(Prisma.sql`
      UPDATE "job_queue" SET
        "state" = 'active',
        "started_at" = NOW(),
        "attempts" = "attempts" + 1
      WHERE "id" IN (
        SELECT "id" FROM "job_queue"
        WHERE "state" = 'pending' AND "run_at" <= NOW()
        ORDER BY "run_at"
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      )
      RETURNING "id", "name", "payload", "attempts", "retry_limit", "retry_delay_sec"
    `);

    return rows.map((row) => ({
      id: row.id,
      name: row.name as JobName,
      payload: row.payload,
      attempts: row.attempts,
      retryLimit: row.retry_limit,
      retryDelaySec: row.retry_delay_sec,
    }));
  }

  async complete(jobId: string): Promise<void> {
    await this.prisma.jobQueue.update({
      where: { id: jobId },
      data: { state: 'done', completedAt: new Date(), lastError: null },
    });
  }

  /**
   * Отметить неудачу. Пока попытки не исчерпаны, задача возвращается в очередь
   * с нарастающей задержкой; после — остаётся как `failed` для разбора.
   */
  async fail(job: ClaimedJob, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    const exhausted = job.attempts >= job.retryLimit;

    if (exhausted) {
      await this.prisma.jobQueue.update({
        where: { id: job.id },
        data: { state: 'failed', completedAt: new Date(), lastError: message.slice(0, 2000) },
      });
      return;
    }

    const backoffSec = job.retryDelaySec * Math.pow(2, job.attempts - 1);
    await this.prisma.jobQueue.update({
      where: { id: job.id },
      data: {
        state: 'pending',
        startedAt: null,
        runAt: new Date(Date.now() + backoffSec * 1000),
        lastError: message.slice(0, 2000),
      },
    });
  }

  /**
   * Вернуть в очередь задачи, зависшие в `active`: функция могла быть прервана
   * по таймауту, и тогда никто уже не проставит результат.
   */
  async requeueStale(olderThanSec: number): Promise<number> {
    const threshold = new Date(Date.now() - olderThanSec * 1000);
    const { count } = await this.prisma.jobQueue.updateMany({
      where: { state: 'active', startedAt: { lt: threshold } },
      data: { state: 'pending', startedAt: null },
    });
    return count;
  }

  async queueSizes(): Promise<Record<string, number>> {
    const rows = await this.prisma.jobQueue.groupBy({
      by: ['state'],
      _count: { _all: true },
    });
    const sizes: Record<string, number> = {};
    let total = 0;
    for (const row of rows) {
      sizes[row.state] = row._count._all;
      if (row.state === 'pending' || row.state === 'active') total += row._count._all;
    }
    sizes.total = total;
    return sizes;
  }

  /** Удаление доведённых до конца задач. Вызывается по расписанию. */
  async purgeCompleted(olderThanDays: number): Promise<number> {
    const threshold = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
    const { count } = await this.prisma.jobQueue.deleteMany({
      where: { state: { in: ['done', 'failed'] }, completedAt: { lt: threshold } },
    });
    return count;
  }
}
