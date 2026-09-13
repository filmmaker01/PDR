import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Cohort, Enrollment } from '@prisma/client';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { AppError } from '@/common/errors/app.error';
import { AccessService } from '@/modules/access/access.service';
import { CatalogService } from '@/modules/learning/catalog/catalog.service';

export interface MigrationReport {
  studentsAffected: number;
  addedStages: string[];
  removedStages: string[];
  addedRequiredLessons: string[];
  addedRequiredAssignments: string[];
  addedRequiredExams: string[];
  /** Ученики, у которых уже засчитанные этапы перестанут быть завершёнными. */
  stagesReopenedFor: { userId: string; stageKeys: string[] }[];
}

@Injectable()
export class CohortsService {
  private readonly logger = new Logger(CohortsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
    private readonly access: AccessService,
  ) {}

  async list(courseId?: string): Promise<(Cohort & { _count: { enrollments: number } })[]> {
    return this.prisma.cohort.findMany({
      where: courseId ? { courseId } : {},
      orderBy: { startsAt: 'desc' },
      include: { _count: { select: { enrollments: true } } },
    });
  }

  async getById(cohortId: string): Promise<Cohort> {
    const cohort = await this.prisma.cohort.findUnique({ where: { id: cohortId } });
    if (!cohort) throw AppError.notFound('Группа не найдена');
    return cohort;
  }

  async create(input: {
    courseId: string;
    courseVersionId?: string;
    title: string;
    unlockMode?: 'interval' | 'dates';
    startsAt: Date;
    stageDates?: Record<string, string> | null;
  }): Promise<Cohort> {
    await this.catalog.getCourse(input.courseId);

    const version = input.courseVersionId
      ? await this.prisma.courseVersion.findUnique({ where: { id: input.courseVersionId } })
      : await this.catalog.latestPublished(input.courseId);

    if (!version) {
      throw AppError.validation(
        'У курса нет опубликованной версии. Опубликуйте версию перед созданием группы',
      );
    }
    if (version.status !== 'published') {
      throw AppError.validation('Группу можно создать только на опубликованной версии');
    }
    if (version.courseId !== input.courseId) {
      throw AppError.validation('Версия относится к другому курсу');
    }

    return this.prisma.cohort.create({
      data: {
        courseId: input.courseId,
        courseVersionId: version.id,
        title: input.title,
        unlockMode: input.unlockMode ?? 'interval',
        startsAt: input.startsAt,
        stageDates: (input.stageDates ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  }

  async update(
    cohortId: string,
    input: {
      title?: string;
      unlockMode?: 'interval' | 'dates';
      startsAt?: Date;
      stageDates?: Record<string, string> | null;
      isActive?: boolean;
    },
  ): Promise<Cohort> {
    await this.getById(cohortId);
    const { stageDates, ...rest } = input;
    return this.prisma.cohort.update({
      where: { id: cohortId },
      data: {
        ...rest,
        ...(stageDates !== undefined
          ? { stageDates: (stageDates ?? Prisma.DbNull) as Prisma.InputJsonValue }
          : {}),
      },
    });
  }

  // ── Кураторы ───────────────────────────────────────────────────────────────

  async addCurator(cohortId: string, userId: string): Promise<void> {
    await this.getById(cohortId);
    const isCurator = await this.prisma.platformRole.findUnique({
      where: { userId_role: { userId, role: 'curator' } },
    });
    if (!isCurator) {
      throw AppError.validation('Назначить куратором можно только пользователя с ролью «куратор»');
    }
    await this.prisma.cohortCurator.upsert({
      where: { cohortId_userId: { cohortId, userId } },
      create: { cohortId, userId },
      update: {},
    });
  }

  async removeCurator(cohortId: string, userId: string): Promise<void> {
    await this.prisma.cohortCurator
      .delete({ where: { cohortId_userId: { cohortId, userId } } })
      .catch(() => undefined);
  }

  async listCurators(cohortId: string) {
    return this.prisma.cohortCurator.findMany({
      where: { cohortId },
      include: { user: { select: { id: true, firstName: true, lastName: true, username: true } } },
    });
  }

  async cohortIdsOfCurator(userId: string): Promise<string[]> {
    const rows = await this.prisma.cohortCurator.findMany({
      where: { userId },
      select: { cohortId: true },
    });
    return rows.map((r) => r.cohortId);
  }

  async isCuratorOf(userId: string, cohortId: string): Promise<boolean> {
    const row = await this.prisma.cohortCurator.findUnique({
      where: { cohortId_userId: { cohortId, userId } },
      select: { cohortId: true },
    });
    return row !== null;
  }

  // ── Зачисления ─────────────────────────────────────────────────────────────

  /**
   * Зачисление: доступ к курсу и запись создаются одной транзакцией.
   * Без доступа зачисление бессмысленно, без зачисления доступ некуда применить.
   */
  async enroll(input: {
    cohortId: string;
    userId: string;
    startedAt?: Date;
    grantValidUntil?: Date | null;
    grantedById: string;
    reason?: string | null;
  }): Promise<Enrollment> {
    const cohort = await this.getById(input.cohortId);

    const existing = await this.prisma.enrollment.findUnique({
      where: { cohortId_userId: { cohortId: input.cohortId, userId: input.userId } },
    });
    if (existing) throw AppError.conflict('Ученик уже зачислен в эту группу');

    const user = await this.prisma.user.findUnique({ where: { id: input.userId } });
    if (!user) throw AppError.notFound('Пользователь не найден');

    return this.prisma.transaction(async (tx) => {
      const grant = await tx.accessGrant.create({
        data: {
          product: 'course',
          subjectType: 'user',
          userId: input.userId,
          courseId: cohort.courseId,
          status: 'active',
          validFrom: new Date(),
          validUntil: input.grantValidUntil ?? null,
          source: 'manual',
          reason: input.reason ?? `зачисление в группу «${cohort.title}»`,
          grantedById: input.grantedById,
        },
      });

      return tx.enrollment.create({
        data: {
          cohortId: input.cohortId,
          userId: input.userId,
          accessGrantId: grant.id,
          startedAt: input.startedAt ?? cohort.startsAt ?? new Date(),
          status: 'active',
        },
      });
    });
  }

  async updateEnrollment(
    enrollmentId: string,
    input: {
      status?: 'active' | 'paused' | 'withdrawn' | 'completed';
      startedAt?: Date;
      note?: string | null;
    },
  ): Promise<Enrollment> {
    await this.getEnrollment(enrollmentId);
    return this.prisma.enrollment.update({
      where: { id: enrollmentId },
      data: {
        ...input,
        ...(input.status === 'completed' ? { completedAt: new Date() } : {}),
        ...(input.status && input.status !== 'completed' ? { completedAt: null } : {}),
      },
    });
  }

  /** Перевод в другую группу того же курса: прогресс по ключам сохраняется. */
  async transferEnrollment(enrollmentId: string, targetCohortId: string): Promise<Enrollment> {
    const enrollment = await this.getEnrollment(enrollmentId);
    const source = await this.getById(enrollment.cohortId);
    const target = await this.getById(targetCohortId);

    if (source.courseId !== target.courseId) {
      throw AppError.validation('Перевести можно только в группу того же курса');
    }
    const occupied = await this.prisma.enrollment.findUnique({
      where: { cohortId_userId: { cohortId: targetCohortId, userId: enrollment.userId } },
    });
    if (occupied) throw AppError.conflict('Ученик уже есть в целевой группе');

    return this.prisma.enrollment.update({
      where: { id: enrollmentId },
      data: { cohortId: targetCohortId },
    });
  }

  async getEnrollment(enrollmentId: string): Promise<Enrollment> {
    const enrollment = await this.prisma.enrollment.findUnique({ where: { id: enrollmentId } });
    if (!enrollment) throw AppError.notFound('Зачисление не найдено');
    return enrollment;
  }

  async listEnrollmentsOfUser(userId: string) {
    return this.prisma.enrollment.findMany({
      where: { userId },
      include: { cohort: { include: { course: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listEnrollments(cohortId: string) {
    return this.prisma.enrollment.findMany({
      where: { cohortId },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, username: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  // ── Перенос группы на другую версию ────────────────────────────────────────

  /**
   * Отчёт о последствиях переноса. Показывается администратору до подтверждения:
   * новые обязательные элементы могут «закрыть» уже засчитанные этапы.
   */
  async previewMigration(cohortId: string, targetVersionId: string): Promise<MigrationReport> {
    const cohort = await this.getById(cohortId);
    const target = await this.prisma.courseVersion.findUnique({ where: { id: targetVersionId } });
    if (!target) throw AppError.notFound('Версия курса не найдена');
    if (target.courseId !== cohort.courseId) {
      throw AppError.validation('Версия относится к другому курсу');
    }
    if (target.status !== 'published') {
      throw AppError.validation('Переносить можно только на опубликованную версию');
    }

    const current = await this.catalog.getVersionTree(cohort.courseVersionId);
    const next = await this.catalog.getVersionTree(targetVersionId);

    const currentStageKeys = new Set(current.stages.map((s) => s.key));
    const nextStageKeys = new Set(next.stages.map((s) => s.key));

    const keysOf = (
      tree: typeof current,
      pick: 'lessons' | 'assignments' | 'exams',
    ): Set<string> => {
      const set = new Set<string>();
      for (const stage of tree.stages) {
        for (const item of stage[pick] as { key: string; isRequired: boolean }[]) {
          if (item.isRequired) set.add(`${stage.key}/${item.key}`);
        }
      }
      return set;
    };

    const addedRequiredLessons = [...keysOf(next, 'lessons')].filter(
      (k) => !keysOf(current, 'lessons').has(k),
    );
    const addedRequiredAssignments = [...keysOf(next, 'assignments')].filter(
      (k) => !keysOf(current, 'assignments').has(k),
    );
    const addedRequiredExams = [...keysOf(next, 'exams')].filter(
      (k) => !keysOf(current, 'exams').has(k),
    );

    const affectedStageKeys = new Set(
      [...addedRequiredLessons, ...addedRequiredAssignments, ...addedRequiredExams].map(
        (k) => k.split('/')[0]!,
      ),
    );

    const enrollments = await this.prisma.enrollment.findMany({
      where: { cohortId },
      select: { id: true, userId: true },
    });
    const stagesReopenedFor: MigrationReport['stagesReopenedFor'] = [];

    for (const enrollment of enrollments) {
      const completions = await this.prisma.stageCompletion.findMany({
        where: { enrollmentId: enrollment.id },
        select: { stageKey: true },
      });
      const affected = completions
        .map((c) => c.stageKey)
        .filter((key) => affectedStageKeys.has(key) || !nextStageKeys.has(key));
      if (affected.length > 0) {
        stagesReopenedFor.push({ userId: enrollment.userId, stageKeys: affected });
      }
    }

    return {
      studentsAffected: enrollments.length,
      addedStages: [...nextStageKeys].filter((k) => !currentStageKeys.has(k)),
      removedStages: [...currentStageKeys].filter((k) => !nextStageKeys.has(k)),
      addedRequiredLessons,
      addedRequiredAssignments,
      addedRequiredExams,
      stagesReopenedFor,
    };
  }

  async migrate(cohortId: string, targetVersionId: string): Promise<MigrationReport> {
    const report = await this.previewMigration(cohortId, targetVersionId);
    await this.prisma.cohort.update({
      where: { id: cohortId },
      data: { courseVersionId: targetVersionId },
    });
    this.logger.log(
      `Группа ${cohortId} переведена на версию ${targetVersionId}, затронуто учеников: ${report.studentsAffected}`,
    );
    return report;
  }

  /** Доступ к курсу конкретного зачисления — для карточки ученика. */
  async courseAccessOf(enrollment: Enrollment, courseId: string) {
    return this.access.check({ product: 'course', userId: enrollment.userId, courseId });
  }
}
