import type { DiscoveryService } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import type { PrismaService } from '@/infra/prisma/prisma.service';
import { JobHandler } from './job-handler';
import type { JobName } from './job-queue';
import { JobRunnerService } from './job-runner.service';
import { CRON_KEY_PREFIX, type JobsService } from './jobs.service';

/** Момент UTC из читаемой записи. */
const at = (iso: string): Date => new Date(`${iso}Z`);

class FakeHandler extends JobHandler {
  constructor(
    readonly jobName: JobName,
    override readonly cron: string,
  ) {
    super();
  }
  async handle(): Promise<void> {}
}

/**
 * Очередь в памяти, повторяющая то, на что опирается `enqueueDue`: ключ
 * уникальности гасит дубль только у ждущей задачи, а прошлый запуск —
 * максимальный cron-ключ задачи, выполнена она или нет.
 */
function fakeQueue() {
  const rows: { name: string; key: string; done: boolean }[] = [];

  const jobs = {
    async lastCronRuns(): Promise<Map<string, Date>> {
      const runs = new Map<string, Date>();
      for (const row of rows) {
        const minute = row.key.slice(`${CRON_KEY_PREFIX}${row.name}:`.length);
        const time = new Date(`${minute}:00Z`);
        const prev = runs.get(row.name);
        if (!prev || time > prev) runs.set(row.name, time);
      }
      return runs;
    },
    async enqueue(name: string, _payload: unknown, opts: { singletonKey: string }) {
      if (rows.some((r) => r.name === name && r.key === opts.singletonKey && !r.done)) return null;
      rows.push({ name, key: opts.singletonKey, done: false });
      return String(rows.length);
    },
  };

  /** Выполнить всё поставленное, как это сделал бы разбор очереди. */
  const drain = (): void => {
    for (const row of rows) row.done = true;
  };

  return { rows, jobs, drain };
}

function runnerWith(handlers: JobHandler[], jobs: unknown): JobRunnerService {
  const discovery = {
    getProviders: () => handlers.map((instance) => ({ instance })),
  } as unknown as DiscoveryService;
  return new JobRunnerService(discovery, jobs as JobsService, {} as PrismaService);
}

const runsOf = (rows: { name: string; key: string }[], name: string): string[] =>
  rows.filter((r) => r.name === name).map((r) => r.key.slice(-16));

describe('JobRunnerService.enqueueDue', () => {
  it('при вызове раз в 15 минут каждая задача ставится ровно в свою минуту', async () => {
    const q = fakeQueue();
    const hourly = new FakeHandler('access.expire', '5 * * * *');
    const frequent = new FakeHandler('exams.expire-attempts', '*/5 * * * *');
    const daily = new FakeHandler('export.cleanup', '20 4 * * *');
    const runner = runnerWith([hourly, frequent, daily], q.jobs);

    // Задачи уже запускались вчера: прошлый запуск известен.
    q.rows.push(
      {
        name: 'access.expire',
        key: `${CRON_KEY_PREFIX}access.expire:2026-09-15T03:05`,
        done: true,
      },
      {
        name: 'exams.expire-attempts',
        key: `${CRON_KEY_PREFIX}exams.expire-attempts:2026-09-15T04:00`,
        done: true,
      },
      {
        name: 'export.cleanup',
        key: `${CRON_KEY_PREFIX}export.cleanup:2026-09-14T04:20`,
        done: true,
      },
    );

    for (const tick of ['04:15', '04:30', '04:45', '05:00', '05:15']) {
      await runner.enqueueDue(at(`2026-09-15T${tick}`));
      q.drain();
    }

    expect(runsOf(q.rows, 'access.expire')).toEqual([
      '2026-09-15T03:05',
      '2026-09-15T04:05',
      '2026-09-15T05:05',
    ]);
    expect(runsOf(q.rows, 'export.cleanup')).toEqual(['2026-09-14T04:20', '2026-09-15T04:20']);
    // Пропущенные «каждые 5 минут» сливаются в один запуск на вызов.
    expect(runsOf(q.rows, 'exams.expire-attempts')).toEqual([
      '2026-09-15T04:00',
      '2026-09-15T04:15',
      '2026-09-15T04:30',
      '2026-09-15T04:45',
      '2026-09-15T05:00',
      '2026-09-15T05:15',
    ]);
  });

  it('повторный вызов не ставит выполненный запуск заново', async () => {
    const q = fakeQueue();
    const runner = runnerWith([new FakeHandler('access.expire', '5 * * * *')], q.jobs);

    expect(await runner.enqueueDue(at('2026-09-15T10:15'))).toBe(1);
    // Ещё не выполнена: дубль гасит ключ уникальности.
    expect(await runner.enqueueDue(at('2026-09-15T10:20'))).toBe(0);
    q.drain();
    // Выполнена: её минута стала прошлым запуском.
    expect(await runner.enqueueDue(at('2026-09-15T10:30'))).toBe(0);
    expect(runsOf(q.rows, 'access.expire')).toEqual(['2026-09-15T10:05']);
  });

  it('после долгого простоя догоняет один раз и не дальше суток', async () => {
    const q = fakeQueue();
    const runner = runnerWith(
      [
        new FakeHandler('access.expire', '5 * * * *'),
        new FakeHandler('backup.verify', '0 6 * * *'),
      ],
      q.jobs,
    );
    q.rows.push({
      name: 'access.expire',
      key: `${CRON_KEY_PREFIX}access.expire:2026-09-01T00:05`,
      done: true,
    });

    expect(await runner.enqueueDue(at('2026-09-15T10:15'))).toBe(2);
    expect(runsOf(q.rows, 'access.expire')).toEqual(['2026-09-01T00:05', '2026-09-15T10:05']);
    // Ни разу не запускавшаяся задача берёт последний запуск за сутки.
    expect(runsOf(q.rows, 'backup.verify')).toEqual(['2026-09-15T06:00']);
  });
});
