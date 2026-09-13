import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Idempotent } from '@/common/interceptors/idempotency.interceptor';
import { zodBody } from '@/common/pipes/zod-validation.pipe';
import { CurrentAuth, type AuthContext } from '@/modules/auth/decorators/auth.decorators';
import { FilesService } from '@/modules/files/files.service';
import { LearningService } from '@/modules/learning/student/learning.service';
import { ExamsService } from './exams.service';
import { attachAttemptFileSchema, saveAnswerSchema } from './dto/exams.dto';

@ApiTags('learning')
@Controller('learning')
export class ExamsController {
  constructor(
    private readonly exams: ExamsService,
    private readonly learning: LearningService,
    private readonly files: FilesService,
  ) {}

  @Get('enrollments/:enrollmentId/exams/:examKey')
  @ApiOperation({ summary: 'Правила экзамена и история попыток' })
  async exam(
    @CurrentAuth() auth: AuthContext,
    @Param('enrollmentId') enrollmentId: string,
    @Param('examKey') examKey: string,
  ) {
    await this.learning.assertOwnEnrollment(enrollmentId, auth.user.id);
    return this.exams.examDetails(enrollmentId, examKey);
  }

  @Post('enrollments/:enrollmentId/exams/:examKey/attempts')
  @Idempotent()
  @ApiOperation({ summary: 'Начать попытку' })
  async start(
    @CurrentAuth() auth: AuthContext,
    @Param('enrollmentId') enrollmentId: string,
    @Param('examKey') examKey: string,
  ) {
    await this.learning.assertOwnEnrollment(enrollmentId, auth.user.id);
    const attempt = await this.exams.startAttempt(enrollmentId, examKey);
    return this.exams.attemptState(attempt.id, enrollmentId);
  }

  @Get('attempts/:attemptId')
  @ApiOperation({ summary: 'Состояние попытки' })
  async attempt(@CurrentAuth() auth: AuthContext, @Param('attemptId') attemptId: string) {
    const enrollmentId = await this.ownEnrollmentOf(attemptId, auth.user.id);
    return this.exams.attemptState(attemptId, enrollmentId);
  }

  @Put('attempts/:attemptId/answers/:questionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Сохранить ответ на вопрос' })
  async saveAnswer(
    @CurrentAuth() auth: AuthContext,
    @Param('attemptId') attemptId: string,
    @Param('questionId') questionId: string,
    @Body(zodBody(saveAnswerSchema))
    body: { selectedOptionIds?: string[]; textAnswer?: string | null },
  ): Promise<void> {
    const enrollmentId = await this.ownEnrollmentOf(attemptId, auth.user.id);
    await this.exams.saveAnswer(attemptId, enrollmentId, questionId, body);
  }

  @Post('attempts/:attemptId/files')
  @ApiOperation({ summary: 'Приложить материал к практическому экзамену' })
  async attachFile(
    @CurrentAuth() auth: AuthContext,
    @Param('attemptId') attemptId: string,
    @Body(zodBody(attachAttemptFileSchema)) body: { fileId: string },
  ) {
    const enrollmentId = await this.ownEnrollmentOf(attemptId, auth.user.id);
    await this.exams.attachFile(attemptId, enrollmentId, body.fileId);
    return { ok: true };
  }

  @Post('attempts/:attemptId/submit')
  @Idempotent()
  @ApiOperation({ summary: 'Завершить попытку' })
  async submit(@CurrentAuth() auth: AuthContext, @Param('attemptId') attemptId: string) {
    const enrollmentId = await this.ownEnrollmentOf(attemptId, auth.user.id);
    const attempt = await this.exams.submitAttempt(attemptId, enrollmentId);
    return {
      id: attempt.id,
      status: attempt.status,
      percent: attempt.percent,
      passed: attempt.passed,
    };
  }

  @Get('attempts/:attemptId/result')
  @ApiOperation({ summary: 'Результат попытки с разбором' })
  async result(@CurrentAuth() auth: AuthContext, @Param('attemptId') attemptId: string) {
    const enrollmentId = await this.ownEnrollmentOf(attemptId, auth.user.id);
    const state = await this.exams.attemptState(attemptId, enrollmentId);
    const attempt = await this.exams.getOwnAttempt(attemptId, enrollmentId);
    const exam = await this.exams.examDetails(enrollmentId, attempt.examKey);

    const fileIds = (await this.exams.attemptForGrading(attemptId)).files.map((f) => f.fileId);
    const thumbs = fileIds.length
      ? await this.files.downloadUrls(fileIds, auth.user, auth.platformRoles, 'thumb')
      : {};

    return {
      ...state,
      score: attempt.score,
      maxScore: attempt.maxScore,
      percent: attempt.percent,
      passed: attempt.passed,
      passingScore: exam.passingScore,
      graderComment: attempt.graderComment,
      availability: exam.availability,
      files: fileIds.map((fileId) => ({ fileId, thumbUrl: thumbs[fileId] ?? null })),
    };
  }

  private async ownEnrollmentOf(attemptId: string, userId: string): Promise<string> {
    const attempt = await this.exams.attemptForGrading(attemptId);
    if (attempt.enrollment.user.id !== userId) {
      const { AppError } = await import('@/common/errors/app.error');
      throw AppError.notFound('Попытка не найдена');
    }
    return attempt.enrollmentId;
  }
}
