import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Idempotent } from '@/common/interceptors/idempotency.interceptor';
import { zodBody } from '@/common/pipes/zod-validation.pipe';
import { AppError } from '@/common/errors/app.error';
import { CurrentAuth, type AuthContext } from '@/modules/auth/decorators/auth.decorators';
import { FilesService } from '@/modules/files/files.service';
import { LearningService } from '@/modules/learning/student/learning.service';
import { SubmissionsService } from './submissions.service';
import {
  attachFileSchema,
  commentSchema,
  copyFilesSchema,
  updateSubmissionSchema,
} from './dto/assignments.dto';

/** Работа ученика со своими сдачами. */
@ApiTags('learning')
@Controller('learning')
export class SubmissionsController {
  constructor(
    private readonly submissions: SubmissionsService,
    private readonly learning: LearningService,
    private readonly files: FilesService,
  ) {}

  @Get('enrollments/:enrollmentId/assignments/:assignmentKey')
  @ApiOperation({ summary: 'Задание с историей сдач' })
  async assignment(
    @CurrentAuth() auth: AuthContext,
    @Param('enrollmentId') enrollmentId: string,
    @Param('assignmentKey') assignmentKey: string,
  ) {
    await this.learning.assertOwnEnrollment(enrollmentId, auth.user.id);
    const details = await this.submissions.assignmentDetails(enrollmentId, assignmentKey);

    const fileIds = details.attempts.flatMap((a) => a.files.map((f) => f.fileId));
    const thumbs = fileIds.length
      ? await this.files.downloadUrls(fileIds, auth.user, auth.platformRoles, 'thumb')
      : {};

    return {
      ...details,
      attempts: details.attempts.map((attempt) => ({
        ...attempt,
        files: attempt.files.map((file) => ({ ...file, thumbUrl: thumbs[file.fileId] ?? null })),
      })),
    };
  }

  @Post('enrollments/:enrollmentId/assignments/:assignmentKey/submissions')
  @ApiOperation({ summary: 'Черновик новой попытки' })
  async createDraft(
    @CurrentAuth() auth: AuthContext,
    @Param('enrollmentId') enrollmentId: string,
    @Param('assignmentKey') assignmentKey: string,
  ) {
    await this.learning.assertOwnEnrollment(enrollmentId, auth.user.id);
    const submission = await this.submissions.createDraft(enrollmentId, assignmentKey);
    return { submissionId: submission.id, attemptNo: submission.attemptNo };
  }

  @Patch('submissions/:submissionId')
  @ApiOperation({ summary: 'Изменение черновика' })
  async updateDraft(
    @CurrentAuth() auth: AuthContext,
    @Param('submissionId') submissionId: string,
    @Body(zodBody(updateSubmissionSchema)) body: { text?: string | null },
  ) {
    const enrollmentId = await this.ownEnrollmentOf(submissionId, auth.user.id);
    const submission = await this.submissions.updateDraft(submissionId, enrollmentId, body);
    return { id: submission.id, status: submission.status };
  }

  @Post('submissions/:submissionId/files')
  @ApiOperation({ summary: 'Приложить загруженный файл' })
  async attachFile(
    @CurrentAuth() auth: AuthContext,
    @Param('submissionId') submissionId: string,
    @Body(zodBody(attachFileSchema)) body: { fileId: string },
  ) {
    const enrollmentId = await this.ownEnrollmentOf(submissionId, auth.user.id);
    await this.submissions.attachFile(submissionId, enrollmentId, body.fileId);
    return { ok: true };
  }

  @Delete('submissions/:submissionId/files/:fileId')
  @ApiOperation({ summary: 'Убрать файл из работы' })
  async detachFile(
    @CurrentAuth() auth: AuthContext,
    @Param('submissionId') submissionId: string,
    @Param('fileId') fileId: string,
  ) {
    const enrollmentId = await this.ownEnrollmentOf(submissionId, auth.user.id);
    await this.submissions.detachFile(submissionId, enrollmentId, fileId);
    return { ok: true };
  }

  @Post('submissions/:submissionId/copy-files')
  @ApiOperation({ summary: 'Перенести файлы из предыдущей попытки' })
  async copyFiles(
    @CurrentAuth() auth: AuthContext,
    @Param('submissionId') submissionId: string,
    @Body(zodBody(copyFilesSchema)) body: { sourceSubmissionId: string },
  ) {
    const enrollmentId = await this.ownEnrollmentOf(submissionId, auth.user.id);
    const copied = await this.submissions.copyFilesFromAttempt(
      submissionId,
      enrollmentId,
      body.sourceSubmissionId,
    );
    return { copied };
  }

  @Post('submissions/:submissionId/submit')
  @Idempotent()
  @ApiOperation({ summary: 'Отправить работу на проверку' })
  async submit(@CurrentAuth() auth: AuthContext, @Param('submissionId') submissionId: string) {
    const enrollmentId = await this.ownEnrollmentOf(submissionId, auth.user.id);
    const submission = await this.submissions.submit(submissionId, enrollmentId);
    return {
      id: submission.id,
      status: submission.status,
      submittedAt: submission.submittedAt?.toISOString() ?? null,
    };
  }

  @Get('submissions/:submissionId')
  @ApiOperation({ summary: 'Работа с проверками и перепиской' })
  async get(@CurrentAuth() auth: AuthContext, @Param('submissionId') submissionId: string) {
    const submission = await this.submissions.getWithContext(submissionId);
    if (submission.enrollment.userId !== auth.user.id) {
      throw AppError.notFound('Работа не найдена');
    }

    const thumbs = await this.files.downloadUrls(
      submission.files.map((f) => f.fileId),
      auth.user,
      auth.platformRoles,
      'thumb',
    );

    return {
      id: submission.id,
      assignmentKey: submission.assignmentKey,
      attemptNo: submission.attemptNo,
      status: submission.status,
      text: submission.text,
      submittedAt: submission.submittedAt?.toISOString() ?? null,
      files: submission.files.map((f) => ({
        fileId: f.fileId,
        mimeType: f.file.mimeType,
        thumbUrl: thumbs[f.fileId] ?? null,
      })),
      reviews: submission.reviews.map((r) => ({
        decision: r.decision,
        comment: r.comment,
        rubric: r.rubric,
        createdAt: r.createdAt.toISOString(),
        reviewer: [r.reviewer.firstName, r.reviewer.lastName].filter(Boolean).join(' '),
      })),
      comments: submission.comments.map((c) => ({
        id: c.id,
        body: c.body,
        createdAt: c.createdAt.toISOString(),
        author: [c.author.firstName, c.author.lastName].filter(Boolean).join(' '),
        isMine: c.author.id === auth.user.id,
      })),
    };
  }

  @Post('submissions/:submissionId/comments')
  @ApiOperation({ summary: 'Комментарий ученика к работе' })
  async comment(
    @CurrentAuth() auth: AuthContext,
    @Param('submissionId') submissionId: string,
    @Body(zodBody(commentSchema)) body: { body: string },
  ) {
    await this.ownEnrollmentOf(submissionId, auth.user.id);
    await this.submissions.addComment(submissionId, auth.user.id, body.body);
    return { ok: true };
  }

  private async ownEnrollmentOf(submissionId: string, userId: string): Promise<string> {
    const submission = await this.submissions.getWithContext(submissionId);
    if (submission.enrollment.userId !== userId) throw AppError.notFound('Работа не найдена');
    return submission.enrollmentId;
  }
}
