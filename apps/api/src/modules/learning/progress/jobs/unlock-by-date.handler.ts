import { Injectable, Logger } from '@nestjs/common';
import { JobHandler } from '@/infra/jobs/job-handler';
import { JOB } from '@/infra/jobs/job-queue';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { ProgressService } from '../progress.service';

/**
 * Этап может открыться просто потому, что наступила дата — без действий ученика.
 * Ежечасный пересчёт замечает это и отправляет уведомление.
 */
@Injectable()
export class UnlockByDateHandler extends JobHandler<typeof JOB.learningUnlockByDate> {
  readonly jobName = JOB.learningUnlockByDate;
  override readonly cron = '10 * * * *';
  private readonly logger = new Logger(UnlockByDateHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly progress: ProgressService,
  ) {
    super();
  }

  async handle(): Promise<void> {
    const enrollments = await this.prisma.enrollment.findMany({
      where: { status: 'active' },
      select: { id: true },
    });

    let processed = 0;
    for (const enrollment of enrollments) {
      try {
        await this.progress.recalculate(enrollment.id);
        processed += 1;
      } catch (err) {
        this.logger.warn({ err, enrollmentId: enrollment.id }, 'Не удалось пересчитать прогресс');
      }
    }
    if (processed > 0) this.logger.log(`Пересчитан прогресс: ${processed} зачислений`);
  }
}
