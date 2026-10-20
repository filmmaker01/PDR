import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { JOB } from '@/infra/jobs/job-queue';
import { JobRunnerService } from '@/infra/jobs/job-runner.service';
import { JobsService } from '@/infra/jobs/jobs.service';
import { createTestApp, truncateAll, type TestApp } from './helpers/app';

/** Момент UTC из читаемой записи. */
const at = (iso: string): Date => new Date(`${iso}Z`);

/**
 * Очередь задач на настоящей PostgreSQL: догоняющее расписание при редком cron
 * и подбор задач, которые не разобрали сразу после запроса.
 */
describe('jobs', () => {
  let ctx: TestApp;
  let runner: JobRunnerService;
  let jobs: JobsService;
  let jobsEnabledBefore: string | undefined;

  beforeAll(async () => {
    jobsEnabledBefore = process.env.JOBS_ENABLED;
    process.env.JOBS_ENABLED = 'true';
    ctx = await createTestApp();
    runner = ctx.app.get(JobRunnerService);
    jobs = ctx.app.get(JobsService);
  });

  afterAll(async () => {
    await truncateAll(ctx.prisma);
    await ctx.close();
    if (jobsEnabledBefore === undefined) delete process.env.JOBS_ENABLED;
    else process.env.JOBS_ENABLED = jobsEnabledBefore;
  });

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
  });

  /** Минуты запуска по расписанию для задачи, по возрастанию. */
  const cronRuns = async (name: string): Promise<string[]> => {
    const rows = await ctx.prisma.jobQueue.findMany({
      where: { name, singletonKey: { startsWith: 'cron:' } },
      select: { singletonKey: true },
    });
    return rows.map((r) => (r.singletonKey as string).slice(-16)).sort();
  };

  /** Считать всё поставленное выполненным, как после разбора очереди. */
  const markAllDone = async (): Promise<void> => {
    await ctx.prisma.jobQueue.updateMany({
      where: { state: 'pending' },
      data: { state: 'done', completedAt: new Date() },
    });
  };

  it('tick в 12:00, пропуск 12:05 и 12:10, tick в 12:15: всё поставлено один раз', async () => {
    await runner.enqueueDue(at('2026-09-15T12:00'));
    await markAllDone();

    // В 12:05 и 12:10 вызовов нет.
    await runner.enqueueDue(at('2026-09-15T12:15'));

    // Ежечасные задачи в :05 и :10 не потерялись.
    expect(await cronRuns(JOB.accessExpire)).toEqual(['2026-09-15T11:05', '2026-09-15T12:05']);
    expect(await cronRuns(JOB.learningUnlockByDate)).toEqual([
      '2026-09-15T11:10',
      '2026-09-15T12:10',
    ]);
    // «Каждые 5/10 минут»: пропущенные запуски слились в один.
    expect(await cronRuns(JOB.examsExpireAttempts)).toEqual([
      '2026-09-15T12:00',
      '2026-09-15T12:15',
    ]);
    expect(await cronRuns(JOB.submissionsReleaseStaleClaims)).toEqual([
      '2026-09-15T12:00',
      '2026-09-15T12:10',
    ]);
    // Ежедневные задачи поставлены один раз — первым вызовом.
    expect(await cronRuns(JOB.exportCleanup)).toEqual(['2026-09-15T04:20']);

    // Повторный вызов — и до выполнения, и после — дублей не даёт.
    expect(await runner.enqueueDue(at('2026-09-15T12:15'))).toBe(0);
    await markAllDone();
    expect(await runner.enqueueDue(at('2026-09-15T12:16'))).toBe(0);
    expect(await cronRuns(JOB.accessExpire)).toEqual(['2026-09-15T11:05', '2026-09-15T12:05']);
  });

  it('параллельные вызовы cron не создают дублей', async () => {
    await runner.enqueueDue(at('2026-09-15T12:00'));
    await markAllDone();

    await Promise.all([
      runner.enqueueDue(at('2026-09-15T12:15')),
      runner.enqueueDue(at('2026-09-15T12:15')),
    ]);

    expect(await cronRuns(JOB.accessExpire)).toEqual(['2026-09-15T11:05', '2026-09-15T12:05']);
    expect(await cronRuns(JOB.examsExpireAttempts)).toEqual([
      '2026-09-15T12:00',
      '2026-09-15T12:15',
    ]);
  });

  it('срочную задачу, не разобранную после запроса, подбирает следующий tick', async () => {
    // Вне Vercel разбора после запроса нет — ровно как если бы waitUntil не сработал.
    const id = await jobs.enqueue(JOB.exportCleanup, {});
    expect(id).not.toBeNull();

    await runner.tick(20_000);

    const job = await ctx.prisma.jobQueue.findUniqueOrThrow({ where: { id: id as string } });
    expect(job.state).toBe('done');
  });

  it('задачу, зависшую в active после обрыва функции, tick возвращает и выполняет', async () => {
    const id = (await jobs.enqueue(JOB.idempotencyCleanup, {})) as string;
    await ctx.prisma.jobQueue.update({
      where: { id },
      data: { state: 'active', attempts: 1, startedAt: new Date(Date.now() - 16 * 60_000) },
    });

    await runner.tick(20_000);

    const job = await ctx.prisma.jobQueue.findUniqueOrThrow({ where: { id } });
    expect(job.state).toBe('done');
  });
});
