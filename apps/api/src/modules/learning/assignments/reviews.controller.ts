import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { zodBody } from '@/common/pipes/zod-validation.pipe';
import {
  CurrentAuth,
  PlatformRoles,
  type AuthContext,
} from '@/modules/auth/decorators/auth.decorators';
import { Audited } from '@/modules/audit/audit.interceptor';
import { FilesService } from '@/modules/files/files.service';
import { SubmissionsService } from './submissions.service';
import { ReviewsService } from './reviews.service';
import { commentSchema, queueQuerySchema, reviewSchema } from './dto/assignments.dto';

/**
 * Проверка работ. Доступна кураторам (в пределах своих групп)
 * и администраторам (по всем группам).
 */
@ApiTags('curator')
@Controller('curator')
@PlatformRoles('curator', 'admin')
export class ReviewsController {
  constructor(
    private readonly reviews: ReviewsService,
    private readonly submissions: SubmissionsService,
    private readonly files: FilesService,
  ) {}

  @Get('cohorts')
  @ApiOperation({ summary: 'Мои группы со счётчиком работ на проверке' })
  async cohorts(@CurrentAuth() auth: AuthContext) {
    const ctx = await this.reviews.buildReviewerContext(auth.user.id, auth.platformRoles);
    return this.reviews.curatorCohorts(ctx);
  }

  @Get('review-queue')
  @ApiOperation({ summary: 'Очередь проверок' })
  async queue(@CurrentAuth() auth: AuthContext, @Query() query: Record<string, string>) {
    const ctx = await this.reviews.buildReviewerContext(auth.user.id, auth.platformRoles);
    const parsed = queueQuerySchema.parse(query);
    return this.reviews.queue(ctx, parsed);
  }

  @Get('submissions/:submissionId')
  @ApiOperation({ summary: 'Работа для проверки' })
  async submission(@CurrentAuth() auth: AuthContext, @Param('submissionId') submissionId: string) {
    const ctx = await this.reviews.buildReviewerContext(auth.user.id, auth.platformRoles);
    await this.reviews.assertCanReview(ctx, submissionId);

    const submission = await this.submissions.getWithContext(submissionId);
    const urls = await this.files.downloadUrls(
      submission.files.map((f) => f.fileId),
      auth.user,
      auth.platformRoles,
      'preview',
    );
    const originals = await this.files.downloadUrls(
      submission.files.map((f) => f.fileId),
      auth.user,
      auth.platformRoles,
      'original',
    );

    // История прошлых попыток помогает понять, что уже исправлено.
    const history = await this.submissions
      .assignmentDetails(submission.enrollmentId, submission.assignmentKey)
      .catch(() => null);

    return {
      id: submission.id,
      assignmentKey: submission.assignmentKey,
      attemptNo: submission.attemptNo,
      status: submission.status,
      text: submission.text,
      submittedAt: submission.submittedAt?.toISOString() ?? null,
      student: {
        id: submission.enrollment.user.id,
        name: [submission.enrollment.user.firstName, submission.enrollment.user.lastName]
          .filter(Boolean)
          .join(' '),
        username: submission.enrollment.user.username,
      },
      cohort: submission.enrollment.cohort,
      enrollmentId: submission.enrollmentId,
      claimedBy: submission.claimedBy
        ? {
            id: submission.claimedBy.id,
            name: [submission.claimedBy.firstName, submission.claimedBy.lastName]
              .filter(Boolean)
              .join(' '),
            isMe: submission.claimedBy.id === auth.user.id,
          }
        : null,
      files: submission.files.map((f) => ({
        fileId: f.fileId,
        mimeType: f.file.mimeType,
        previewUrl: urls[f.fileId] ?? null,
        originalUrl: originals[f.fileId] ?? null,
      })),
      comments: submission.comments.map((c) => ({
        id: c.id,
        body: c.body,
        createdAt: c.createdAt.toISOString(),
        author: [c.author.firstName, c.author.lastName].filter(Boolean).join(' '),
        isMine: c.author.id === auth.user.id,
      })),
      previousAttempts:
        history?.attempts
          .filter((a) => a.id !== submission.id)
          .map((a) => ({
            attemptNo: a.attemptNo,
            status: a.status,
            submittedAt: a.submittedAt,
            review: a.review,
          })) ?? [],
    };
  }

  @Post('submissions/:submissionId/claim')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Взять работу на проверку' })
  async claim(
    @CurrentAuth() auth: AuthContext,
    @Param('submissionId') submissionId: string,
  ): Promise<void> {
    const ctx = await this.reviews.buildReviewerContext(auth.user.id, auth.platformRoles);
    await this.reviews.claim(ctx, submissionId);
  }

  @Post('submissions/:submissionId/release')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Вернуть работу в общую очередь' })
  async release(
    @CurrentAuth() auth: AuthContext,
    @Param('submissionId') submissionId: string,
  ): Promise<void> {
    const ctx = await this.reviews.buildReviewerContext(auth.user.id, auth.platformRoles);
    await this.reviews.release(ctx, submissionId);
  }

  @Post('submissions/:submissionId/review')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Audited({ entityType: 'submission', action: 'review', idFrom: { param: 'submissionId' } })
  @ApiOperation({ summary: 'Решение по работе' })
  async review(
    @CurrentAuth() auth: AuthContext,
    @Param('submissionId') submissionId: string,
    @Body(zodBody(reviewSchema))
    body: {
      decision: 'accepted' | 'returned';
      comment: string;
      rubric?: Record<string, number> | null;
    },
  ): Promise<void> {
    const ctx = await this.reviews.buildReviewerContext(auth.user.id, auth.platformRoles);
    await this.reviews.review(ctx, submissionId, body);
  }

  @Post('submissions/:submissionId/comments')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Уточняющий комментарий без решения' })
  async comment(
    @CurrentAuth() auth: AuthContext,
    @Param('submissionId') submissionId: string,
    @Body(zodBody(commentSchema)) body: { body: string },
  ): Promise<void> {
    const ctx = await this.reviews.buildReviewerContext(auth.user.id, auth.platformRoles);
    await this.reviews.comment(ctx, submissionId, body.body);
  }
}
