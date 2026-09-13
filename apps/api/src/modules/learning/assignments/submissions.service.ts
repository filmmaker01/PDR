import { Injectable, Logger } from '@nestjs/common';
import type { Prisma, Submission } from '@prisma/client';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { AppError } from '@/common/errors/app.error';
import { FilesService } from '@/modules/files/files.service';
import { StageAccessService } from '@/modules/learning/progress/stage-access.service';
import { ProgressService } from '@/modules/learning/progress/progress.service';

export interface RequiredMedia {
  min_photos?: number;
  min_videos?: number;
  text_required?: boolean;
}

@Injectable()
export class SubmissionsService {
  private readonly logger = new Logger(SubmissionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stageAccess: StageAccessService,
    private readonly progress: ProgressService,
    private readonly files: FilesService,
  ) {}

  /** Задание вместе с этапом, которому оно принадлежит. */
  private async findAssignment(enrollmentId: string, assignmentKey: string) {
    const ctx = await this.stageAccess.loadContext(enrollmentId);
    const stage = ctx.version.stages.find((s) =>
      s.assignments.some((a) => a.key === assignmentKey),
    );
    const assignment = stage?.assignments.find((a) => a.key === assignmentKey);
    if (!stage || !assignment) throw AppError.notFound('Задание не найдено');
    return { ctx, stage, assignment };
  }

  async assignmentDetails(enrollmentId: string, assignmentKey: string) {
    const { stage, assignment } = await this.findAssignment(enrollmentId, assignmentKey);
    await this.stageAccess.assertStageOpen(enrollmentId, stage.key);

    const submissions = await this.prisma.submission.findMany({
      where: { enrollmentId, assignmentKey },
      orderBy: { attemptNo: 'desc' },
      include: {
        files: { include: { file: true }, orderBy: { position: 'asc' } },
        reviews: {
          orderBy: { createdAt: 'desc' },
          include: { reviewer: { select: { firstName: true, lastName: true } } },
        },
      },
    });

    const active = submissions.find((s) => ['draft', 'submitted', 'in_review'].includes(s.status));

    return {
      key: assignment.key,
      stageKey: stage.key,
      title: assignment.title,
      instructions: assignment.instructions,
      isRequired: assignment.isRequired,
      requiredMedia: assignment.requiredMedia as RequiredMedia,
      maxVideoSec: assignment.maxVideoSec,
      accepted: submissions.some((s) => s.status === 'accepted'),
      activeSubmissionId: active?.id ?? null,
      attempts: submissions.map((submission) => ({
        id: submission.id,
        attemptNo: submission.attemptNo,
        status: submission.status,
        text: submission.text,
        submittedAt: submission.submittedAt?.toISOString() ?? null,
        reviewedAt: submission.reviewedAt?.toISOString() ?? null,
        files: submission.files.map((f) => ({
          fileId: f.fileId,
          mimeType: f.file.mimeType,
          status: f.file.status,
        })),
        review: submission.reviews[0]
          ? {
              decision: submission.reviews[0].decision,
              comment: submission.reviews[0].comment,
              rubric: submission.reviews[0].rubric,
              createdAt: submission.reviews[0].createdAt.toISOString(),
              reviewer: [
                submission.reviews[0].reviewer.firstName,
                submission.reviews[0].reviewer.lastName,
              ]
                .filter(Boolean)
                .join(' '),
            }
          : null,
      })),
    };
  }

  /**
   * Черновик сдачи. Нужен, чтобы загружать файлы до отправки:
   * загрузка идёт напрямую в хранилище и занимает время.
   */
  async createDraft(enrollmentId: string, assignmentKey: string): Promise<Submission> {
    const { stage } = await this.findAssignment(enrollmentId, assignmentKey);
    await this.stageAccess.assertStageOpen(enrollmentId, stage.key);

    const existing = await this.prisma.submission.findFirst({
      where: {
        enrollmentId,
        assignmentKey,
        status: { in: ['draft', 'submitted', 'in_review'] },
      },
    });
    if (existing) {
      if (existing.status === 'draft') return existing;
      throw new AppError(
        'submission_in_progress',
        'Предыдущая работа ещё на проверке. Дождитесь решения куратора',
      );
    }

    const last = await this.prisma.submission.findFirst({
      where: { enrollmentId, assignmentKey },
      orderBy: { attemptNo: 'desc' },
      select: { attemptNo: true },
    });

    return this.prisma.submission.create({
      data: {
        enrollmentId,
        assignmentKey,
        attemptNo: (last?.attemptNo ?? 0) + 1,
        status: 'draft',
      },
    });
  }

  async getOwnDraft(submissionId: string, enrollmentId: string): Promise<Submission> {
    const submission = await this.prisma.submission.findUnique({ where: { id: submissionId } });
    if (!submission || submission.enrollmentId !== enrollmentId) {
      throw AppError.notFound('Работа не найдена');
    }
    if (submission.status !== 'draft') {
      throw AppError.conflict('Отправленную работу изменить нельзя');
    }
    return submission;
  }

  async updateDraft(
    submissionId: string,
    enrollmentId: string,
    input: { text?: string | null },
  ): Promise<Submission> {
    await this.getOwnDraft(submissionId, enrollmentId);
    return this.prisma.submission.update({
      where: { id: submissionId },
      data: { text: input.text ?? null },
    });
  }

  async attachFile(submissionId: string, enrollmentId: string, fileId: string): Promise<void> {
    await this.getOwnDraft(submissionId, enrollmentId);

    const file = await this.files.getById(fileId);
    if (file.scope !== 'submission') {
      throw AppError.validation('Этот файл нельзя приложить к работе');
    }

    const enrollment = await this.prisma.enrollment.findUnique({
      where: { id: enrollmentId },
      select: { userId: true },
    });
    if (file.ownerUserId !== enrollment?.userId) {
      throw AppError.notFound('Файл не найден');
    }

    const last = await this.prisma.submissionFile.findFirst({
      where: { submissionId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });

    await this.prisma.submissionFile
      .create({ data: { submissionId, fileId, position: (last?.position ?? 0) + 1 } })
      .catch(() => undefined);
  }

  async detachFile(submissionId: string, enrollmentId: string, fileId: string): Promise<void> {
    await this.getOwnDraft(submissionId, enrollmentId);
    await this.prisma.submissionFile
      .delete({ where: { submissionId_fileId: { submissionId, fileId } } })
      .catch(() => undefined);
  }

  /** Отправка на проверку: сверяем требования задания к составу работы. */
  async submit(submissionId: string, enrollmentId: string): Promise<Submission> {
    const submission = await this.getOwnDraft(submissionId, enrollmentId);
    const { stage, assignment } = await this.findAssignment(enrollmentId, submission.assignmentKey);
    await this.stageAccess.assertStageOpen(enrollmentId, stage.key);

    const files = await this.prisma.submissionFile.findMany({
      where: { submissionId },
      include: { file: true },
    });

    const required = (assignment.requiredMedia ?? {}) as RequiredMedia;
    const photos = files.filter((f) => f.file.mimeType.startsWith('image/'));
    const videos = files.filter((f) => f.file.mimeType.startsWith('video/'));
    const problems: string[] = [];

    if ((required.min_photos ?? 0) > photos.length) {
      problems.push(`нужно фото: ${required.min_photos}, приложено ${photos.length}`);
    }
    if ((required.min_videos ?? 0) > videos.length) {
      problems.push(`нужно видео: ${required.min_videos}, приложено ${videos.length}`);
    }
    if (required.text_required && !submission.text?.trim()) {
      problems.push('нужно описание работы');
    }
    const notReady = files.filter((f) => f.file.status !== 'ready');
    if (notReady.length > 0) {
      problems.push(`файлы ещё обрабатываются: ${notReady.length}`);
    }

    if (problems.length > 0) {
      throw AppError.validation(`Работа не готова к отправке: ${problems.join('; ')}`);
    }

    const updated = await this.prisma.submission.update({
      where: { id: submissionId },
      data: { status: 'submitted', submittedAt: new Date() },
    });
    this.logger.log(
      { submissionId, assignmentKey: submission.assignmentKey },
      'Работа отправлена на проверку',
    );
    return updated;
  }

  /** Копирование файлов предыдущей попытки: пересъёмка всего заново избыточна. */
  async copyFilesFromAttempt(
    submissionId: string,
    enrollmentId: string,
    sourceSubmissionId: string,
  ): Promise<number> {
    await this.getOwnDraft(submissionId, enrollmentId);
    const source = await this.prisma.submission.findUnique({
      where: { id: sourceSubmissionId },
      include: { files: { orderBy: { position: 'asc' } } },
    });
    if (!source || source.enrollmentId !== enrollmentId) {
      throw AppError.notFound('Предыдущая работа не найдена');
    }

    let copied = 0;
    for (const [index, file] of source.files.entries()) {
      const created = await this.prisma.submissionFile
        .create({ data: { submissionId, fileId: file.fileId, position: index + 1 } })
        .catch(() => null);
      if (created) copied += 1;
    }
    return copied;
  }

  async getWithContext(submissionId: string) {
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      include: {
        enrollment: {
          include: {
            user: { select: { id: true, firstName: true, lastName: true, username: true } },
            cohort: { select: { id: true, title: true, courseId: true, courseVersionId: true } },
          },
        },
        files: { include: { file: true }, orderBy: { position: 'asc' } },
        reviews: {
          orderBy: { createdAt: 'desc' },
          include: { reviewer: { select: { firstName: true, lastName: true } } },
        },
        comments: {
          orderBy: { createdAt: 'asc' },
          include: { author: { select: { id: true, firstName: true, lastName: true } } },
        },
        claimedBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    if (!submission) throw AppError.notFound('Работа не найдена');
    return submission;
  }

  /** Ключи принятых работ — источник фактов для правил открытия этапов. */
  async acceptedAssignmentKeys(enrollmentId: string): Promise<string[]> {
    const rows = await this.prisma.submission.findMany({
      where: { enrollmentId, status: 'accepted' },
      select: { assignmentKey: true },
      distinct: ['assignmentKey'],
    });
    return rows.map((r) => r.assignmentKey);
  }

  async addComment(submissionId: string, authorId: string, body: string): Promise<void> {
    await this.prisma.reviewComment.create({ data: { submissionId, authorId, body } });
  }

  /** Пересчёт прогресса после решения по работе. */
  async recalculateAfterReview(enrollmentId: string): Promise<void> {
    await this.progress.recalculate(enrollmentId);
  }

  static requiredMediaOf(value: Prisma.JsonValue | null): RequiredMedia {
    return (value ?? {}) as RequiredMedia;
  }
}
