import { Injectable, Logger } from '@nestjs/common';
import type { LessonProgress } from '@prisma/client';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { AppError } from '@/common/errors/app.error';
import { NotificationsService } from '@/modules/notifications/notifications.service';
import { StageAccessService } from './stage-access.service';

/**
 * Прогресс ученика и пересчёт завершения этапов.
 *
 * Пересчёт вызывается после каждого события, которое может повлиять
 * на завершение: отметка урока, решение по работе, оценка экзамена,
 * ручное открытие или закрытие этапа администратором.
 */
@Injectable()
export class ProgressService {
  private readonly logger = new Logger(ProgressService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stageAccess: StageAccessService,
    private readonly notifications: NotificationsService,
  ) {}

  async trackWatch(
    enrollmentId: string,
    lessonKey: string,
    input: { positionSec: number; percent: number },
  ): Promise<LessonProgress> {
    const percent = Math.min(Math.max(Math.round(input.percent), 0), 100);
    const positionSec = Math.max(Math.round(input.positionSec), 0);
    const now = new Date();

    const existing = await this.prisma.lessonProgress.findUnique({
      where: { enrollmentId_lessonKey: { enrollmentId, lessonKey } },
    });

    return this.prisma.lessonProgress.upsert({
      where: { enrollmentId_lessonKey: { enrollmentId, lessonKey } },
      create: {
        enrollmentId,
        lessonKey,
        watchPositionSec: positionSec,
        watchPercent: percent,
        firstOpenedAt: now,
        lastOpenedAt: now,
      },
      update: {
        watchPositionSec: positionSec,
        // Процент только растёт: перемотка назад не должна «отнимать» прогресс.
        watchPercent: Math.max(percent, existing?.watchPercent ?? 0),
        lastOpenedAt: now,
      },
    });
  }

  async markOpened(enrollmentId: string, lessonKey: string): Promise<void> {
    const now = new Date();
    await this.prisma.lessonProgress.upsert({
      where: { enrollmentId_lessonKey: { enrollmentId, lessonKey } },
      create: { enrollmentId, lessonKey, firstOpenedAt: now, lastOpenedAt: now },
      update: { lastOpenedAt: now },
    });
  }

  /**
   * Отметка урока пройденным.
   * Порог просмотра — вспомогательный показатель, но если он задан,
   * отметить урок без него нельзя: иначе обязательность превращается в формальность.
   */
  async completeLesson(enrollmentId: string, lessonKey: string): Promise<LessonProgress> {
    const ctx = await this.stageAccess.loadContext(enrollmentId);
    const stage = ctx.version.stages.find((s) => s.lessons.some((l) => l.key === lessonKey));
    const lesson = stage?.lessons.find((l) => l.key === lessonKey);
    if (!stage || !lesson) throw AppError.notFound('Урок не найден');

    await this.stageAccess.assertStageOpen(enrollmentId, stage.key);

    const progress = await this.prisma.lessonProgress.findUnique({
      where: { enrollmentId_lessonKey: { enrollmentId, lessonKey } },
    });

    if (lesson.minWatchPercent > 0 && (progress?.watchPercent ?? 0) < lesson.minWatchPercent) {
      throw AppError.validation(
        `Посмотрите не менее ${lesson.minWatchPercent}% урока, чтобы отметить его пройденным`,
      );
    }

    const updated = await this.prisma.lessonProgress.upsert({
      where: { enrollmentId_lessonKey: { enrollmentId, lessonKey } },
      create: {
        enrollmentId,
        lessonKey,
        completedAt: new Date(),
        firstOpenedAt: new Date(),
        lastOpenedAt: new Date(),
      },
      update: { completedAt: progress?.completedAt ?? new Date() },
    });

    await this.recalculate(enrollmentId);
    return updated;
  }

  async uncompleteLesson(enrollmentId: string, lessonKey: string): Promise<void> {
    await this.prisma.lessonProgress.updateMany({
      where: { enrollmentId, lessonKey },
      data: { completedAt: null },
    });
    await this.recalculate(enrollmentId);
  }

  /**
   * Пересчёт завершения этапов и уведомления об открытии следующего.
   * Идемпотентен: повторный вызов не создаёт лишних уведомлений.
   */
  async recalculate(enrollmentId: string): Promise<void> {
    const before = await this.prisma.stageCompletion.findMany({ where: { enrollmentId } });
    const ctx = await this.stageAccess.loadContext(enrollmentId);
    const facts = await this.stageAccess.loadCompletionFacts(enrollmentId);
    const existingKeys = new Set(before.map((c) => c.stageKey));

    for (const stage of ctx.version.stages) {
      const progress = this.stageAccess.requirementProgress(ctx.version, stage.key, facts);
      const complete = this.stageAccess.isStageComplete(progress);

      if (complete && !existingKeys.has(stage.key)) {
        await this.prisma.stageCompletion.create({
          data: { enrollmentId, stageKey: stage.key, completedAt: new Date() },
        });
      } else if (!complete && existingKeys.has(stage.key)) {
        // Требования могли вырасти после переноса группы на новую версию.
        await this.prisma.stageCompletion.delete({
          where: { enrollmentId_stageKey: { enrollmentId, stageKey: stage.key } },
        });
      }
    }

    await this.notifyOpenStages(enrollmentId);
    await this.maybeCompleteEnrollment(enrollmentId);
  }

  /**
   * Уведомление об открытых этапах.
   *
   * Однократность обеспечивает ключ дедупликации, а не сравнение состояний:
   * к моменту пересчёта изменение уже записано в базу, поэтому «было/стало»
   * здесь ненадёжно. Ключ же гарантирует ровно одно сообщение на этап.
   */
  private async notifyOpenStages(enrollmentId: string): Promise<void> {
    const states = await this.stageAccess.getStageStates(enrollmentId);
    const enrollment = await this.prisma.enrollment.findUnique({
      where: { id: enrollmentId },
      select: { userId: true },
    });
    if (!enrollment) return;

    for (const state of states) {
      if (state.access.status !== 'open') continue;

      await this.notifications.notify({
        userId: enrollment.userId,
        type: 'stage_unlocked',
        payload: {
          stageTitle: state.stageTitle,
          stageKey: state.stageKey,
          enrollmentId,
        },
        dedupeKey: `stage_unlocked:${enrollmentId}:${state.stageKey}`,
      });
    }
  }

  private async maybeCompleteEnrollment(enrollmentId: string): Promise<void> {
    const ctx = await this.stageAccess.loadContext(enrollmentId);
    if (ctx.enrollment.status !== 'active') return;

    const completions = await this.prisma.stageCompletion.count({ where: { enrollmentId } });
    if (ctx.version.stages.length > 0 && completions >= ctx.version.stages.length) {
      await this.prisma.enrollment.update({
        where: { id: enrollmentId },
        data: { status: 'completed', completedAt: new Date() },
      });
      this.logger.log(`Зачисление ${enrollmentId} завершено: все этапы пройдены`);
    }
  }

  async listLessonProgress(enrollmentId: string): Promise<LessonProgress[]> {
    return this.prisma.lessonProgress.findMany({ where: { enrollmentId } });
  }

  /** Открытие или закрытие этапа администратором. Причина обязательна. */
  async setOverride(input: {
    enrollmentId: string;
    stageKey: string;
    action: 'unlock' | 'lock';
    reason: string;
    createdById: string;
    expiresAt?: Date | null;
  }): Promise<void> {
    const ctx = await this.stageAccess.loadContext(input.enrollmentId);
    if (!ctx.version.stages.some((s) => s.key === input.stageKey)) {
      throw AppError.notFound('Этап не найден в версии курса этой группы');
    }

    await this.prisma.stageOverride.create({
      data: {
        enrollmentId: input.enrollmentId,
        stageKey: input.stageKey,
        action: input.action,
        reason: input.reason,
        createdById: input.createdById,
        expiresAt: input.expiresAt ?? null,
      },
    });
    await this.recalculate(input.enrollmentId);
  }

  async removeOverride(overrideId: string): Promise<void> {
    const override = await this.prisma.stageOverride.findUnique({ where: { id: overrideId } });
    if (!override) throw AppError.notFound('Исключение не найдено');
    await this.prisma.stageOverride.delete({ where: { id: overrideId } });
    await this.recalculate(override.enrollmentId);
  }

  async listOverrides(enrollmentId: string) {
    return this.prisma.stageOverride.findMany({
      where: { enrollmentId },
      orderBy: { createdAt: 'desc' },
      include: { createdBy: { select: { firstName: true, lastName: true } } },
    });
  }
}
