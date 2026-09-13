import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import PgBoss from 'pg-boss';
import { AppConfigService } from '@/config/config.service';
import { JOB, type JobName, type JobPayloads } from './job-queue';

export interface EnqueueOptions {
  /** Задержка перед выполнением, секунды. */
  startAfterSec?: number;
  /** Точное время выполнения. */
  startAfter?: Date;
  /** Ключ уникальности: повторная постановка с тем же ключом не создаёт дубль. */
  singletonKey?: string;
  retryLimit?: number;
  retryDelaySec?: number;
  /** Использовать существующее соединение (постановка задачи в одной транзакции с данными). */
  db?: { executeSql: (text: string, values: unknown[]) => Promise<{ rows: unknown[] }> };
}

/**
 * Очередь фоновых задач поверх PostgreSQL (pg-boss).
 * API-процесс только ставит задачи; обработчики регистрирует worker.
 */
@Injectable()
export class JobsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobsService.name);
  private boss: PgBoss | null = null;
  private started = false;

  constructor(private readonly config: AppConfigService) {}

  async onModuleInit(): Promise<void> {
    if (this.config.isTest && process.env.JOBS_ENABLED !== 'true') {
      this.logger.log('Очередь отключена в тестовом окружении');
      return;
    }
    await this.start();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.boss) {
      await this.boss.stop({ graceful: true, timeout: 10_000 });
      this.boss = null;
      this.started = false;
    }
  }

  private async start(): Promise<void> {
    if (this.started) return;
    this.boss = new PgBoss({
      connectionString: this.config.env.DATABASE_URL,
      schema: 'pgboss',
      retryLimit: 3,
      retryBackoff: true,
      archiveCompletedAfterSeconds: 60 * 60 * 24,
      deleteAfterDays: 14,
    });
    this.boss.on('error', (err) => this.logger.error({ err }, 'Ошибка очереди'));
    await this.boss.start();
    // pg-boss 10 не создаёт очередь сам: и send(), и work() требуют,
    // чтобы запись в pgboss.queue уже существовала. Команда идемпотентна,
    // поэтому её безопасно выполнять при каждом старте любого процесса.
    for (const name of Object.values(JOB)) {
      await this.boss.createQueue(name);
    }
    this.started = true;
    this.logger.log('Очередь запущена');
  }

  get instance(): PgBoss {
    if (!this.boss) throw new Error('Очередь не запущена');
    return this.boss;
  }

  get isEnabled(): boolean {
    return this.started;
  }

  /** Постановка задачи. Если очередь отключена (тесты) — no-op с записью в лог. */
  async enqueue<N extends JobName>(
    name: N,
    payload: JobPayloads[N],
    options: EnqueueOptions = {},
  ): Promise<string | null> {
    if (!this.boss) {
      this.logger.debug({ name, payload }, 'Очередь отключена, задача пропущена');
      return null;
    }
    const sendOptions: PgBoss.SendOptions = {
      retryLimit: options.retryLimit ?? 3,
      retryDelay: options.retryDelaySec ?? 30,
      retryBackoff: true,
    };
    if (options.startAfter) sendOptions.startAfter = options.startAfter;
    else if (options.startAfterSec) sendOptions.startAfter = options.startAfterSec;
    if (options.singletonKey) sendOptions.singletonKey = options.singletonKey;
    if (options.db) sendOptions.db = options.db as PgBoss.Db;

    return this.boss.send(name, payload as object, sendOptions);
  }

  /** Регистрация расписания (cron, UTC). Вызывается только worker'ом. */
  async schedule(name: JobName, cron: string): Promise<void> {
    await this.instance.schedule(name, cron, {}, { tz: 'UTC' });
  }

  async work<N extends JobName>(
    name: N,
    handler: (payload: JobPayloads[N], jobId: string) => Promise<void>,
    options: { batchSize?: number; pollIntervalSec?: number } = {},
  ): Promise<void> {
    await this.instance.work<JobPayloads[N]>(
      name,
      { batchSize: options.batchSize ?? 1, pollingIntervalSeconds: options.pollIntervalSec ?? 2 },
      async (jobs) => {
        for (const job of jobs) {
          await handler(job.data, job.id);
        }
      },
    );
  }

  async queueSizes(): Promise<Record<string, number>> {
    if (!this.boss) return {};
    const states = await this.boss.getQueueSize('*').catch(() => 0);
    return { total: typeof states === 'number' ? states : 0 };
  }
}
