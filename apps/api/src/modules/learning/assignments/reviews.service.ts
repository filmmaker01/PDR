import { Injectable, Logger } from '@nestjs/common';
import type { Prisma, Submission } from '@prisma/client';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { AppError } from '@/common/errors/app.error';
import { NotificationsService } from '@/modules/notifications/notifications.service';
import { CohortsService } from '@/modules/learning/cohorts/cohorts.service';
import { CatalogService } from '@/modules/learning/catalog/catalog.service';
import { SubmissionsService } from './submissions.service';

/** Сколько работа остаётся закреплённой за куратором без решения. */
export const CLAIM_TTL_MS = 30 * 60_000;

export interface ReviewerContext {
  userId: string;
  isAdmin: boolean;
  /** Группы, которые ведёт куратор. Для администратора не ограничивает. */
  cohortIds: string[];
}

@Injectable()
export class ReviewsService {
  private readonly logger = new Logger(ReviewsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly submissions: SubmissionsService,
    private readonly cohorts: CohortsService,
    private readonly catalog: CatalogService,
    private readonly notifications: NotificationsService,
  ) {}

  async buildReviewerContext(userId: string, platformRoles: string[]): Promise<ReviewerContext> {
    const isAdmin = platformRoles.includes('admin');
    const cohortIds = isAdmin ? [] : await this.cohorts.cohortIdsOfCurator(userId);
    if (!isAdmin && cohortIds.length === 0 && !platformRoles.includes('curator')) {
      throw AppError.notFound('Раздел недоступен');
    }
    return { userId, isAdmin, cohortIds };
  }

  private cohortFilter(ctx: ReviewerContext): Prisma.SubmissionWhereInput {
    return ctx.isAdmin ? {} : { enrollment: { cohortId: { in: ctx.cohortIds } } };
  }

  /** Очередь проверок: сначала те, кто ждёт дольше всех. */
  async queue(
    ctx: ReviewerContext,
    filter: { cohortId?: string; assignmentKey?: string; onlyMine?: boolean; limit: number },
  ) {
    const submissions = await this.prisma.submission.findMany({
      where: {
        status: { in: ['submitted', 'in_review'] },
        ...this.cohortFilter(ctx),
        ...(filter.cohortId ? { enrollment: { cohortId: filter.cohortId } } : {}),
        ...(filter.assignmentKey ? { assignmentKey: filter.assignmentKey } : {}),
        ...(filter.onlyMine ? { claimedById: ctx.userId } : {}),
      },
      orderBy: { submittedAt: 'asc' },
      take: filter.limit,
      include: {
        enrollment: {
          include: {
            user: { select: { firstName: true, lastName: true, username: true } },
            cohort: { select: { id: true, title: true, courseVersionId: true } },
          },
        },
        claimedBy: { select: { id: true, firstName: true, lastName: true } },
        files: { select: { fileId: true } },
      },
    });

    const titleCache = new Map<string, string>();
    const result = [];

    for (const submission of submissions) {
      const cacheKey = `${submission.enrollment.cohort.courseVersionId}:${submission.assignmentKey}`;
      if (!titleCache.has(cacheKey)) {
        const version = await this.catalog.getVersionTree(
          submission.enrollment.cohort.courseVersionId,
        );
        for (const stage of version.stages) {
          for (const assignment of stage.assignments) {
            titleCache.set(
              `${submission.enrollment.cohort.courseVersionId}:${assignment.key}`,
              assignment.title,
            );
          }
        }
      }

      const claimStale =
        submission.claimedAt !== null && Date.now() - submission.claimedAt.getTime() > CLAIM_TTL_MS;

      result.push({
        id: submission.id,
        assignmentKey: submission.assignmentKey,
        assignmentTitle: titleCache.get(cacheKey) ?? submission.assignmentKey,
        attemptNo: submission.attemptNo,
        status: submission.status,
        submittedAt: submission.submittedAt?.toISOString() ?? null,
        waitingHours: submission.submittedAt
          ? Math.floor((Date.now() - submission.submittedAt.getTime()) / 3_600_000)
          : 0,
        filesCount: submission.files.length,
        student: {
          name: [submission.enrollment.user.firstName, submission.enrollment.user.lastName]
            .filter(Boolean)
            .join(' '),
          username: submission.enrollment.user.username,
        },
        cohort: {
          id: submission.enrollment.cohort.id,
          title: submission.enrollment.cohort.title,
        },
        claimedBy:
          submission.claimedBy && !claimStale
            ? {
                id: submission.claimedBy.id,
                name: [submission.claimedBy.firstName, submission.claimedBy.lastName]
                  .filter(Boolean)
                  .join(' '),
                isMe: submission.claimedBy.id === ctx.userId,
              }
            : null,
      });
    }

    return result;
  }

  /** Проверка права на конкретную работу. */
  async assertCanReview(ctx: ReviewerContext, submissionId: string): Promise<Submission> {
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      include: { enrollment: { select: { cohortId: true } } },
    });
    if (!submission) throw AppError.notFound('Работа не найдена');

    if (!ctx.isAdmin && !ctx.cohortIds.includes(submission.enrollment.cohortId)) {
      throw AppError.notFound('Работа не найдена');
    }
    const { enrollment, ...rest } = submission;
    void enrollment;
    return rest as Submission;
  }

  /**
   * Взять работу на проверку.
   * Удержание нужно, чтобы двое кураторов не писали разные решения одновременно;
   * через 30 минут без решения работа возвращается в общую очередь.
   */
  async claim(ctx: ReviewerContext, submissionId: string): Promise<void> {
    const submission = await this.assertCanReview(ctx, submissionId);
    if (submission.status === 'accepted' || submission.status === 'returned') {
      throw AppError.conflict('Работа уже проверена');
    }

    const staleBefore = new Date(Date.now() - CLAIM_TTL_MS);
    const claimed = await this.prisma.submission.updateMany({
      where: {
        id: submissionId,
        status: { in: ['submitted', 'in_review'] },
        OR: [
          { claimedById: null },
          { claimedById: ctx.userId },
          { claimedAt: { lt: staleBefore } },
        ],
      },
      data: { status: 'in_review', claimedById: ctx.userId, claimedAt: new Date() },
    });

    if (claimed.count === 0) {
      throw AppError.conflict('Работу уже проверяет другой куратор');
    }
  }

  async release(ctx: ReviewerContext, submissionId: string): Promise<void> {
    await this.assertCanReview(ctx, submissionId);
    await this.prisma.submission.updateMany({
      where: { id: submissionId, status: 'in_review', claimedById: ctx.userId },
      data: { status: 'submitted', claimedById: null, claimedAt: null },
    });
  }

  /** Решение куратора. Комментарий обязателен: «возвращено» без объяснения бесполезно. */
  async review(
    ctx: ReviewerContext,
    submissionId: string,
    input: {
      decision: 'accepted' | 'returned';
      comment: string;
      rubric?: Record<string, number> | null;
    },
  ): Promise<void> {
    const submission = await this.assertCanReview(ctx, submissionId);
    if (submission.status === 'draft') {
      throw AppError.conflict('Работа ещё не отправлена на проверку');
    }
    if (submission.status === 'accepted' || submission.status === 'returned') {
      throw AppError.conflict('Работа уже проверена');
    }

    const enrollment = await this.prisma.enrollment.findUnique({
      where: { id: submission.enrollmentId },
      select: { userId: true, cohort: { select: { courseVersionId: true } } },
    });
    if (!enrollment) throw AppError.notFound('Зачисление не найдено');

    const version = await this.catalog.getVersionTree(enrollment.cohort.courseVersionId);
    const assignmentTitle =
      version.stages.flatMap((s) => s.assignments).find((a) => a.key === submission.assignmentKey)
        ?.title ?? submission.assignmentKey;

    await this.prisma.transaction(async (tx) => {
      await tx.review.create({
        data: {
          submissionId,
          reviewerId: ctx.userId,
          decision: input.decision,
          comment: input.comment,
          rubric: (input.rubric ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      });
      await tx.submission.update({
        where: { id: submissionId },
        data: {
          status: input.decision === 'accepted' ? 'accepted' : 'returned',
          reviewedAt: new Date(),
          claimedById: null,
          claimedAt: null,
        },
      });
    });

    await this.notifications.notify({
      userId: enrollment.userId,
      type: 'review_result',
      payload: {
        decision: input.decision,
        assignmentTitle,
        comment: input.comment,
        submissionId,
      },
      dedupeKey: `review_result:${submissionId}`,
    });

    // Принятая работа может закрыть этап и открыть следующий.
    await this.submissions.recalculateAfterReview(submission.enrollmentId);

    this.logger.log({ submissionId, decision: input.decision }, 'Работа проверена');
  }

  async comment(ctx: ReviewerContext, submissionId: string, body: string): Promise<void> {
    const submission = await this.assertCanReview(ctx, submissionId);
    await this.submissions.addComment(submissionId, ctx.userId, body);

    const enrollment = await this.prisma.enrollment.findUnique({
      where: { id: submission.enrollmentId },
      select: { userId: true },
    });
    if (enrollment) {
      await this.notifications.notify({
        userId: enrollment.userId,
        type: 'submission_comment',
        payload: { submissionId, comment: body, assignmentTitle: submission.assignmentKey },
      });
    }
  }

  /** Снятие зависших удержаний: куратор мог закрыть приложение. */
  async releaseStaleClaims(): Promise<number> {
    const result = await this.prisma.submission.updateMany({
      where: {
        status: 'in_review',
        claimedAt: { lt: new Date(Date.now() - CLAIM_TTL_MS) },
      },
      data: { status: 'submitted', claimedById: null, claimedAt: null },
    });
    if (result.count > 0) {
      this.logger.log(`Снято зависших удержаний: ${result.count}`);
    }
    return result.count;
  }

  async curatorCohorts(ctx: ReviewerContext) {
    const cohorts = await this.prisma.cohort.findMany({
      where: ctx.isAdmin ? {} : { id: { in: ctx.cohortIds } },
      include: {
        course: { select: { title: true } },
        _count: { select: { enrollments: true } },
      },
      orderBy: { startsAt: 'desc' },
    });

    return Promise.all(
      cohorts.map(async (cohort) => ({
        id: cohort.id,
        title: cohort.title,
        courseTitle: cohort.course.title,
        studentsCount: cohort._count.enrollments,
        pendingReviews: await this.prisma.submission.count({
          where: {
            status: { in: ['submitted', 'in_review'] },
            enrollment: { cohortId: cohort.id },
          },
        }),
      })),
    );
  }
}
