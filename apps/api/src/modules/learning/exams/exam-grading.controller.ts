import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { zodBody } from '@/common/pipes/zod-validation.pipe';
import { AppError } from '@/common/errors/app.error';
import {
  CurrentAuth,
  PlatformRoles,
  type AuthContext,
} from '@/modules/auth/decorators/auth.decorators';
import { Audited } from '@/modules/audit/audit.interceptor';
import { FilesService } from '@/modules/files/files.service';
import { CohortsService } from '@/modules/learning/cohorts/cohorts.service';
import { ExamsService } from './exams.service';
import { cancelAttemptSchema, gradePracticalSchema } from './dto/exams.dto';

const queueQuery = z.object({ limit: z.coerce.number().int().min(1).max(200).default(100) });

/** Оценка практических экзаменов куратором и администратором. */
@ApiTags('curator')
@Controller('curator')
@PlatformRoles('curator', 'admin')
export class ExamGradingController {
  constructor(
    private readonly exams: ExamsService,
    private readonly cohorts: CohortsService,
    private readonly files: FilesService,
  ) {}

  private async cohortScope(auth: AuthContext): Promise<string[] | null> {
    if (auth.platformRoles.includes('admin')) return null;
    return this.cohorts.cohortIdsOfCurator(auth.user.id);
  }

  @Get('exam-queue')
  @ApiOperation({ summary: 'Практические экзамены на оценку' })
  async queue(@CurrentAuth() auth: AuthContext, @Query() query: Record<string, string>) {
    const { limit } = queueQuery.parse(query);
    return this.exams.gradingQueue(await this.cohortScope(auth), limit);
  }

  @Get('attempts/:attemptId')
  @ApiOperation({ summary: 'Попытка для оценки' })
  async attempt(@CurrentAuth() auth: AuthContext, @Param('attemptId') attemptId: string) {
    const attempt = await this.assertCanGrade(auth, attemptId);

    const urls = await this.files.downloadUrls(
      attempt.files.map((f) => f.fileId),
      auth.user,
      auth.platformRoles,
      'preview',
    );
    const originals = await this.files.downloadUrls(
      attempt.files.map((f) => f.fileId),
      auth.user,
      auth.platformRoles,
      'original',
    );

    return {
      id: attempt.id,
      examKey: attempt.examKey,
      examTitle: attempt.exam.title,
      examDescription: attempt.exam.description,
      passingScore: attempt.exam.passingScore,
      attemptNo: attempt.attemptNo,
      status: attempt.status,
      submittedAt: attempt.submittedAt?.toISOString() ?? null,
      score: attempt.score,
      passed: attempt.passed,
      graderComment: attempt.graderComment,
      enrollmentId: attempt.enrollmentId,
      student: {
        id: attempt.enrollment.user.id,
        name: [attempt.enrollment.user.firstName, attempt.enrollment.user.lastName]
          .filter(Boolean)
          .join(' '),
        username: attempt.enrollment.user.username,
      },
      cohort: attempt.enrollment.cohort,
      files: attempt.files.map((f) => ({
        fileId: f.fileId,
        mimeType: f.file.mimeType,
        previewUrl: urls[f.fileId] ?? null,
        originalUrl: originals[f.fileId] ?? null,
      })),
    };
  }

  @Post('attempts/:attemptId/grade')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Audited({ entityType: 'exam_attempt', action: 'grade', idFrom: { param: 'attemptId' } })
  @ApiOperation({ summary: 'Оценка практического экзамена' })
  async grade(
    @CurrentAuth() auth: AuthContext,
    @Param('attemptId') attemptId: string,
    @Body(zodBody(gradePracticalSchema)) body: { score: number; comment: string },
  ): Promise<void> {
    await this.assertCanGrade(auth, attemptId);
    await this.exams.gradePractical(attemptId, auth.user.id, body);
  }

  private async assertCanGrade(auth: AuthContext, attemptId: string) {
    const attempt = await this.exams.attemptForGrading(attemptId);
    const scope = await this.cohortScope(auth);
    if (scope !== null && !scope.includes(attempt.enrollment.cohortId)) {
      throw AppError.notFound('Попытка не найдена');
    }
    return attempt;
  }
}

/** Аннулирование попытки — только администратор платформы. */
@ApiTags('admin')
@Controller('admin/attempts')
@PlatformRoles('admin')
export class AdminAttemptsController {
  constructor(private readonly exams: ExamsService) {}

  @Post(':attemptId/cancel')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Audited({ entityType: 'exam_attempt', action: 'cancel', idFrom: { param: 'attemptId' } })
  @ApiOperation({ summary: 'Аннулировать попытку с указанием причины' })
  async cancel(
    @Param('attemptId') attemptId: string,
    @Body(zodBody(cancelAttemptSchema)) body: { reason: string },
  ): Promise<void> {
    await this.exams.cancelAttempt(attemptId, body.reason);
  }
}
