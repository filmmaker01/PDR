import { Injectable } from '@nestjs/common';
import type { Cohort, Enrollment, Prisma } from '@prisma/client';
import { addDays } from '@pdr/shared';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { AccessService } from '@/modules/access/access.service';
import { CatalogService, type VersionTree } from '@/modules/learning/catalog/catalog.service';
import { CompletionFactsRegistry } from './completion-facts.registry';
import type {
  LockReason,
  MissingRequirement,
  StageAccess,
  StageRequirementProgress,
} from './stage-access.types';

export interface EnrollmentContext {
  enrollment: Enrollment;
  cohort: Cohort;
  version: VersionTree;
  hasCourseAccess: boolean;
  courseAccessValidUntil: Date | null;
}

export interface StageState {
  stageKey: string;
  stageTitle: string;
  access: StageAccess;
  progress: StageRequirementProgress;
}

/** Что ученик уже выполнил внутри этапа. */
export interface CompletionFacts {
  completedLessonKeys: Set<string>;
  acceptedAssignmentKeys: Set<string>;
  passedExamKeys: Set<string>;
}

/**
 * Вычисление доступности этапов.
 *
 * Правило (утверждено заказчиком): этап открывается, когда выполнено
 * **одновременно** временное условие и требования предыдущего этапа.
 * Ручное открытие или закрытие администратором имеет приоритет над обоими.
 */
@Injectable()
export class StageAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly catalog: CatalogService,
    private readonly facts: CompletionFactsRegistry,
  ) {}

  async loadContext(enrollmentId: string): Promise<EnrollmentContext> {
    const enrollment = await this.prisma.enrollment.findUnique({
      where: { id: enrollmentId },
      include: { cohort: true },
    });
    if (!enrollment) throw new Error('Зачисление не найдено');

    const version = await this.catalog.getVersionTree(enrollment.cohort.courseVersionId);
    const grant = await this.access.check({
      product: 'course',
      userId: enrollment.userId,
      courseId: enrollment.cohort.courseId,
    });

    const { cohort, ...rest } = enrollment;
    return {
      enrollment: rest as Enrollment,
      cohort,
      version,
      hasCourseAccess: grant.granted,
      courseAccessValidUntil: grant.validUntil,
    };
  }

  /** Факты выполнения: уроки — здесь, практика и экзамены — из реестра источников. */
  async loadCompletionFacts(enrollmentId: string): Promise<CompletionFacts> {
    const [lessons, assignmentKeys, examKeys] = await Promise.all([
      this.prisma.lessonProgress.findMany({
        where: { enrollmentId, completedAt: { not: null } },
        select: { lessonKey: true },
      }),
      this.facts.getAcceptedAssignmentKeys(enrollmentId),
      this.facts.getPassedExamKeys(enrollmentId),
    ]);

    return {
      completedLessonKeys: new Set(lessons.map((l) => l.lessonKey)),
      acceptedAssignmentKeys: new Set(assignmentKeys),
      passedExamKeys: new Set(examKeys),
    };
  }

  /** Дата, с которой этап открывается по времени. */
  unlockDateFor(ctx: EnrollmentContext, stageKey: string, unlockDaysOffset: number): Date {
    if (ctx.cohort.unlockMode === 'dates') {
      const dates = (ctx.cohort.stageDates ?? {}) as Record<string, string>;
      const explicit = dates[stageKey];
      if (explicit) return new Date(explicit);
      return ctx.cohort.startsAt;
    }
    // Режим по умолчанию: дни от индивидуального старта ученика.
    return addDays(ctx.enrollment.startedAt, unlockDaysOffset);
  }

  /** Требования этапа и что из них выполнено. */
  requirementProgress(
    version: VersionTree,
    stageKey: string,
    facts: CompletionFacts,
  ): StageRequirementProgress {
    const stage = version.stages.find((s) => s.key === stageKey);
    if (!stage) {
      return {
        lessons: { done: 0, total: 0 },
        assignments: { done: 0, total: 0 },
        exams: { done: 0, total: 0 },
      };
    }

    const requiredLessons = stage.lessons.filter((l) => l.isRequired);
    const requiredAssignments = stage.assignments.filter((a) => a.isRequired);
    const requiredExams = stage.exams.filter((e) => e.isRequired);

    return {
      lessons: {
        done: requiredLessons.filter((l) => facts.completedLessonKeys.has(l.key)).length,
        total: requiredLessons.length,
      },
      assignments: {
        done: requiredAssignments.filter((a) => facts.acceptedAssignmentKeys.has(a.key)).length,
        total: requiredAssignments.length,
      },
      exams: {
        done: requiredExams.filter((e) => facts.passedExamKeys.has(e.key)).length,
        total: requiredExams.length,
      },
    };
  }

  private missingOf(progress: StageRequirementProgress): MissingRequirement[] {
    const missing: MissingRequirement[] = [];
    if (progress.lessons.done < progress.lessons.total) missing.push('lessons');
    if (progress.assignments.done < progress.assignments.total) missing.push('assignments');
    if (progress.exams.done < progress.exams.total) missing.push('exams');
    return missing;
  }

  isStageComplete(progress: StageRequirementProgress): boolean {
    return this.missingOf(progress).length === 0;
  }

  private describeMissing(missing: MissingRequirement[]): string {
    const parts: string[] = [];
    if (missing.includes('lessons')) parts.push('пройдены не все уроки');
    if (missing.includes('assignments')) parts.push('практика ещё не принята');
    if (missing.includes('exams')) parts.push('экзамен не сдан');
    return parts.join(', ');
  }

  private formatDate(date: Date): string {
    return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(date);
  }

  /** Действующее ручное исключение: последнее по времени, не истёкшее. */
  async activeOverride(
    enrollmentId: string,
    stageKey: string,
    now: Date,
  ): Promise<{ action: 'unlock' | 'lock'; reason: string } | null> {
    const override = await this.prisma.stageOverride.findFirst({
      where: {
        enrollmentId,
        stageKey,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      orderBy: { createdAt: 'desc' },
    });
    return override ? { action: override.action, reason: override.reason } : null;
  }

  /** Состояние всех этапов курса для ученика. */
  async getStageStates(enrollmentId: string, now = new Date()): Promise<StageState[]> {
    const ctx = await this.loadContext(enrollmentId);
    const facts = await this.loadCompletionFacts(enrollmentId);
    const completions = await this.prisma.stageCompletion.findMany({ where: { enrollmentId } });
    const completionByKey = new Map(completions.map((c) => [c.stageKey, c.completedAt]));

    const states: StageState[] = [];
    let previousComplete = true;
    let previousKey: string | null = null;
    let previousTitle = '';
    let previousMissing: MissingRequirement[] = [];

    for (const stage of ctx.version.stages) {
      const progress = this.requirementProgress(ctx.version, stage.key, facts);
      const complete = this.isStageComplete(progress);
      const override = await this.activeOverride(enrollmentId, stage.key, now);
      const unlockAt = this.unlockDateFor(ctx, stage.key, stage.unlockDaysOffset);

      const access = this.resolveAccess({
        ctx,
        now,
        override,
        unlockAt,
        requiresPrevious: stage.requiresPreviousStage,
        previous: previousKey
          ? {
              key: previousKey,
              title: previousTitle,
              complete: previousComplete,
              missing: previousMissing,
            }
          : null,
        completedAt: completionByKey.get(stage.key) ?? null,
      });

      states.push({ stageKey: stage.key, stageTitle: stage.title, access, progress });

      previousComplete = complete;
      previousKey = stage.key;
      previousTitle = stage.title;
      previousMissing = this.missingOf(progress);
    }

    return states;
  }

  async getStageAccess(
    enrollmentId: string,
    stageKey: string,
    now = new Date(),
  ): Promise<StageAccess> {
    const states = await this.getStageStates(enrollmentId, now);
    const state = states.find((s) => s.stageKey === stageKey);
    if (!state) {
      return {
        status: 'locked',
        reasons: [{ code: 'manual_lock', reason: 'этап не найден', message: 'Этап недоступен' }],
        opensAt: null,
      };
    }
    return state.access;
  }

  /**
   * Итоговое решение по одному этапу.
   * Причины возвращаются все сразу: ученик должен видеть полную картину,
   * а не узнавать о следующем препятствии после устранения предыдущего.
   */
  private resolveAccess(input: {
    ctx: EnrollmentContext;
    now: Date;
    override: { action: 'unlock' | 'lock'; reason: string } | null;
    unlockAt: Date;
    requiresPrevious: boolean;
    previous: {
      key: string;
      title: string;
      complete: boolean;
      missing: MissingRequirement[];
    } | null;
    completedAt: Date | null;
  }): StageAccess {
    const { ctx, now, override, unlockAt, requiresPrevious, previous, completedAt } = input;

    // Ручное закрытие сильнее любых правил.
    if (override?.action === 'lock') {
      return {
        status: 'locked',
        reasons: [
          {
            code: 'manual_lock',
            reason: override.reason,
            message: `Этап закрыт администратором: ${override.reason}`,
          },
        ],
        opensAt: null,
      };
    }

    if (!ctx.hasCourseAccess) {
      return {
        status: 'locked',
        reasons: [
          {
            code: 'no_course_access',
            message: 'Доступ к курсу завершён. Прогресс сохранён, обратитесь за продлением',
          },
        ],
        opensAt: null,
      };
    }

    if (ctx.enrollment.status === 'paused' || ctx.enrollment.status === 'withdrawn') {
      return {
        status: 'locked',
        reasons: [
          {
            code: 'enrollment_inactive',
            status: ctx.enrollment.status,
            message:
              ctx.enrollment.status === 'paused'
                ? 'Обучение приостановлено'
                : 'Обучение прекращено',
          },
        ],
        opensAt: null,
      };
    }

    // Ручное открытие пропускает срок и требования предыдущего этапа.
    if (override?.action === 'unlock') {
      return completedAt
        ? { status: 'completed', completedAt: completedAt.toISOString() }
        : { status: 'open' };
    }

    const reasons: LockReason[] = [];

    if (unlockAt.getTime() > now.getTime()) {
      reasons.push({
        code: 'date',
        opensAt: unlockAt.toISOString(),
        message: `Откроется ${this.formatDate(unlockAt)}`,
      });
    }

    if (requiresPrevious && previous && !previous.complete) {
      reasons.push({
        code: 'previous_stage',
        stageKey: previous.key,
        stageTitle: previous.title,
        missing: previous.missing,
        message: `Сначала завершите этап «${previous.title}»: ${this.describeMissing(previous.missing)}`,
      });
    }

    if (reasons.length > 0) {
      return {
        status: 'locked',
        reasons,
        opensAt: unlockAt.getTime() > now.getTime() ? unlockAt.toISOString() : null,
      };
    }

    return completedAt
      ? { status: 'completed', completedAt: completedAt.toISOString() }
      : { status: 'open' };
  }

  /** Проверка перед выдачей содержимого: видео, материалы, сдача, экзамен. */
  async assertStageOpen(enrollmentId: string, stageKey: string): Promise<void> {
    const access = await this.getStageAccess(enrollmentId, stageKey);
    if (access.status === 'locked') {
      const { AppError } = await import('@/common/errors/app.error');
      const first = access.reasons[0];
      throw new AppError(
        first?.code === 'no_course_access' ? 'product_access_required' : 'stage_locked',
        first?.message ?? 'Этап пока недоступен',
        { reasons: access.reasons },
      );
    }
  }

  /** Ключ этапа, которому принадлежит урок/задание/экзамен. */
  stageKeyOfLesson(version: VersionTree, lessonKey: string): string | null {
    return version.stages.find((s) => s.lessons.some((l) => l.key === lessonKey))?.key ?? null;
  }

  stageKeyOfAssignment(version: VersionTree, assignmentKey: string): string | null {
    return (
      version.stages.find((s) => s.assignments.some((a) => a.key === assignmentKey))?.key ?? null
    );
  }

  stageKeyOfExam(version: VersionTree, examKey: string): string | null {
    return version.stages.find((s) => s.exams.some((e) => e.key === examKey))?.key ?? null;
  }

  static emptyStageDates(): Prisma.InputJsonValue {
    return {};
  }
}
