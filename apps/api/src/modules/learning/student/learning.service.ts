import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { AppError } from '@/common/errors/app.error';
import { VideoService } from '@/modules/learning/catalog/video.service';
import { FilesService } from '@/modules/files/files.service';
import { StageAccessService } from '@/modules/learning/progress/stage-access.service';
import { ProgressService } from '@/modules/learning/progress/progress.service';
import type { StageAccess } from '@/modules/learning/progress/stage-access.types';
import { VideoSessionService } from '@/modules/learning/video-access/video-session.service';
import type { PlaybackCapabilities, PlaybackTicket } from '@/infra/video/video.types';

export interface CourseMap {
  enrollmentId: string;
  courseTitle: string;
  cohortTitle: string;
  status: string;
  startedAt: string;
  access: { active: boolean; validUntil: string | null };
  overall: { lessons: { done: number; total: number }; stages: { done: number; total: number } };
  stages: {
    key: string;
    title: string;
    description: string | null;
    access: StageAccess;
    progress: {
      lessons: { done: number; total: number };
      assignments: { done: number; total: number };
      exams: { done: number; total: number };
    };
  }[];
}

@Injectable()
export class LearningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stageAccess: StageAccessService,
    private readonly progress: ProgressService,
    private readonly video: VideoService,
    private readonly videoSessions: VideoSessionService,
    private readonly files: FilesService,
  ) {}

  /** Зачисление принадлежит пользователю — иначе 404, а не 403. */
  async assertOwnEnrollment(enrollmentId: string, userId: string): Promise<void> {
    const enrollment = await this.prisma.enrollment.findUnique({
      where: { id: enrollmentId },
      select: { userId: true },
    });
    if (!enrollment || enrollment.userId !== userId) {
      throw AppError.notFound('Обучение не найдено');
    }
  }

  async listEnrollments(userId: string) {
    const enrollments = await this.prisma.enrollment.findMany({
      where: { userId },
      include: { cohort: { include: { course: true } } },
      orderBy: { createdAt: 'desc' },
    });

    return Promise.all(
      enrollments.map(async (enrollment) => {
        const ctx = await this.stageAccess.loadContext(enrollment.id);
        const completions = await this.prisma.stageCompletion.count({
          where: { enrollmentId: enrollment.id },
        });
        return {
          id: enrollment.id,
          courseId: enrollment.cohort.courseId,
          courseTitle: enrollment.cohort.course.title,
          cohortTitle: enrollment.cohort.title,
          status: enrollment.status,
          startedAt: enrollment.startedAt.toISOString(),
          hasActiveAccess: ctx.hasCourseAccess,
          accessValidUntil: ctx.courseAccessValidUntil?.toISOString() ?? null,
          stagesTotal: ctx.version.stages.length,
          stagesDone: completions,
        };
      }),
    );
  }

  /** Карта курса: этапы, состояние доступа и прогресс по каждому. */
  async courseMap(enrollmentId: string): Promise<CourseMap> {
    const ctx = await this.stageAccess.loadContext(enrollmentId);
    const states = await this.stageAccess.getStageStates(enrollmentId);
    const cohort = await this.prisma.cohort.findUnique({
      where: { id: ctx.enrollment.cohortId },
      include: { course: true },
    });

    const lessonsDone = states.reduce((sum, s) => sum + s.progress.lessons.done, 0);
    const lessonsTotal = states.reduce((sum, s) => sum + s.progress.lessons.total, 0);
    const stagesDone = states.filter((s) => s.access.status === 'completed').length;

    return {
      enrollmentId,
      courseTitle: cohort?.course.title ?? '',
      cohortTitle: cohort?.title ?? '',
      status: ctx.enrollment.status,
      startedAt: ctx.enrollment.startedAt.toISOString(),
      access: {
        active: ctx.hasCourseAccess,
        validUntil: ctx.courseAccessValidUntil?.toISOString() ?? null,
      },
      overall: {
        lessons: { done: lessonsDone, total: lessonsTotal },
        stages: { done: stagesDone, total: states.length },
      },
      stages: states.map((state) => {
        const stage = ctx.version.stages.find((s) => s.key === state.stageKey);
        return {
          key: state.stageKey,
          title: state.stageTitle,
          description: stage?.description ?? null,
          access: state.access,
          progress: state.progress,
        };
      }),
    };
  }

  /** Содержимое этапа. Закрытый этап отдаёт причины, но не материалы. */
  async stageDetails(enrollmentId: string, stageKey: string) {
    const ctx = await this.stageAccess.loadContext(enrollmentId);
    const stage = ctx.version.stages.find((s) => s.key === stageKey);
    if (!stage) throw AppError.notFound('Этап не найден');

    const access = await this.stageAccess.getStageAccess(enrollmentId, stageKey);
    if (access.status === 'locked') {
      return {
        key: stage.key,
        title: stage.title,
        description: stage.description,
        access,
        lessons: [],
        assignments: [],
        exams: [],
      };
    }

    const progressRows = await this.progress.listLessonProgress(enrollmentId);
    const progressByKey = new Map(progressRows.map((p) => [p.lessonKey, p]));
    const facts = await this.stageAccess.loadCompletionFacts(enrollmentId);

    return {
      key: stage.key,
      title: stage.title,
      description: stage.description,
      access,
      lessons: stage.lessons.map((lesson) => {
        const progress = progressByKey.get(lesson.key);
        return {
          key: lesson.key,
          title: lesson.title,
          isRequired: lesson.isRequired,
          estimatedMinutes: lesson.estimatedMinutes,
          minWatchPercent: lesson.minWatchPercent,
          hasVideo: lesson.videoAssetId !== null,
          materialsCount: lesson.materials.length,
          progress: {
            completed: progress?.completedAt !== null && progress?.completedAt !== undefined,
            watchPercent: progress?.watchPercent ?? 0,
            watchPositionSec: progress?.watchPositionSec ?? 0,
          },
        };
      }),
      assignments: stage.assignments.map((assignment) => ({
        key: assignment.key,
        title: assignment.title,
        isRequired: assignment.isRequired,
        accepted: facts.acceptedAssignmentKeys.has(assignment.key),
      })),
      exams: stage.exams.map((exam) => ({
        key: exam.key,
        title: exam.title,
        kind: exam.kind,
        isRequired: exam.isRequired,
        passingScore: exam.passingScore,
        passed: facts.passedExamKeys.has(exam.key),
      })),
    };
  }

  /**
   * Урок с билетом на воспроизведение.
   * Доступ к просмотру видео здесь не выдаётся: он запрашивается отдельно,
   * живёт минуты и проверяется заново. Скрытая кнопка защитой не является.
   */
  async lessonDetails(enrollmentId: string, lessonKey: string) {
    const ctx = await this.stageAccess.loadContext(enrollmentId);
    const stageKey = this.stageAccess.stageKeyOfLesson(ctx.version, lessonKey);
    if (!stageKey) throw AppError.notFound('Урок не найден');

    await this.stageAccess.assertStageOpen(enrollmentId, stageKey);

    const stage = ctx.version.stages.find((s) => s.key === stageKey)!;
    const lesson = stage.lessons.find((l) => l.key === lessonKey)!;
    await this.progress.markOpened(enrollmentId, lessonKey);

    const progress = await this.prisma.lessonProgress.findUnique({
      where: { enrollmentId_lessonKey: { enrollmentId, lessonKey } },
    });

    const index = stage.lessons.findIndex((l) => l.key === lessonKey);

    return {
      key: lesson.key,
      stageKey,
      title: lesson.title,
      description: lesson.description,
      isRequired: lesson.isRequired,
      minWatchPercent: lesson.minWatchPercent,
      estimatedMinutes: lesson.estimatedMinutes,
      // Ни адреса плеера, ни тем более ссылки на поток здесь нет: доступ к
      // просмотру запрашивается отдельно и живёт минуты, а не пока открыт урок.
      video: lesson.videoAssetId
        ? {
            status: lesson.videoAsset?.status ?? 'processing',
            durationSec: lesson.videoAsset?.durationSec ?? null,
          }
        : null,
      materials: lesson.materials.map((m) => ({
        id: m.id,
        kind: m.kind,
        title: m.title,
        url: m.url,
        body: m.body,
        fileId: m.fileId,
      })),
      assignments: stage.assignments
        .filter((a) => a.lessonId === lesson.id)
        .map((a) => ({ key: a.key, title: a.title })),
      progress: {
        completed: progress?.completedAt !== null && progress?.completedAt !== undefined,
        watchPercent: progress?.watchPercent ?? 0,
        watchPositionSec: progress?.watchPositionSec ?? 0,
      },
      navigation: {
        previousKey: index > 0 ? (stage.lessons[index - 1]?.key ?? null) : null,
        nextKey: index < stage.lessons.length - 1 ? (stage.lessons[index + 1]?.key ?? null) : null,
      },
    };
  }

  /**
   * Сессия просмотра урока.
   *
   * Выдаётся только после полной проверки: зачисление принадлежит этому
   * пользователю, доступ к курсу действует, этап открыт, урок существует в
   * опубликованной версии и к нему привязано готовое видео. Любой из этих
   * пунктов не сошёлся — билета нет.
   */
  async issuePlayback(input: {
    enrollmentId: string;
    lessonKey: string;
    userId: string;
    capabilities: PlaybackCapabilities;
    ip?: string | null;
    userAgent?: string | null;
  }): Promise<PlaybackTicket & { sessionId: string }> {
    await this.assertOwnEnrollment(input.enrollmentId, input.userId);

    const ctx = await this.stageAccess.loadContext(input.enrollmentId);
    const stageKey = this.stageAccess.stageKeyOfLesson(ctx.version, input.lessonKey);
    if (!stageKey) throw AppError.notFound('Урок не найден');

    // Здесь же проверяется и доступ к курсу: закрытый этап отдаёт
    // product_access_required, если причина в нём.
    await this.stageAccess.assertStageOpen(input.enrollmentId, stageKey);

    const stage = ctx.version.stages.find((s) => s.key === stageKey)!;
    const lesson = stage.lessons.find((l) => l.key === input.lessonKey);
    if (!lesson?.videoAssetId) throw AppError.notFound('К уроку не приложено видео');

    const issued = await this.videoSessions.issue({
      userId: input.userId,
      enrollmentId: input.enrollmentId,
      lessonKey: input.lessonKey,
      videoAssetId: lesson.videoAssetId,
      capabilities: input.capabilities,
      ip: input.ip,
      userAgent: input.userAgent,
    });

    const ticket = await this.video.issuePlayback(lesson.videoAssetId, {
      authToken: issued.authToken,
      watermark: issued.watermark ?? '',
      drm: issued.drm,
      ttlSec: Math.max(1, Math.round((issued.session.expiresAt.getTime() - Date.now()) / 1000)),
    });

    return { ...ticket, sessionId: issued.session.id };
  }

  /** Ссылка на файл материала: проверяется открытость этапа. */
  async materialDownloadUrl(
    enrollmentId: string,
    lessonKey: string,
    materialId: string,
    userId: string,
    platformRoles: string[],
  ): Promise<{ url: string; expiresAt: string }> {
    const ctx = await this.stageAccess.loadContext(enrollmentId);
    const stageKey = this.stageAccess.stageKeyOfLesson(ctx.version, lessonKey);
    if (!stageKey) throw AppError.notFound('Урок не найден');
    await this.stageAccess.assertStageOpen(enrollmentId, stageKey);

    const stage = ctx.version.stages.find((s) => s.key === stageKey)!;
    const lesson = stage.lessons.find((l) => l.key === lessonKey)!;
    const material = lesson.materials.find((m) => m.id === materialId);
    if (!material?.fileId) throw AppError.notFound('Материал не найден');

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw AppError.notFound('Пользователь не найден');

    return this.files.downloadUrl(material.fileId, user, platformRoles, 'original');
  }
}
