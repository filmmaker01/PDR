import type { JobName, JobPayloads } from './job-queue';

/**
 * Базовый класс обработчика фоновой задачи.
 * Worker находит всех наследников через DiscoveryService и подписывает на очередь.
 */
export abstract class JobHandler<N extends JobName = JobName> {
  abstract readonly jobName: N;
  /** Расписание cron (UTC) для периодических задач. */
  readonly cron?: string;
  readonly batchSize?: number;
  abstract handle(payload: JobPayloads[N], jobId: string): Promise<void>;
}
