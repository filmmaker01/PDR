import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { zodBody } from '@/common/pipes/zod-validation.pipe';
import { CurrentAuth, type AuthContext } from '@/modules/auth/decorators/auth.decorators';
import { ProgressService } from '@/modules/learning/progress/progress.service';
import { LearningService } from './learning.service';

const watchProgressSchema = z
  .object({
    positionSec: z.number().int().min(0).max(86_400),
    percent: z.number().int().min(0).max(100),
  })
  .strict();

@ApiTags('learning')
@Controller('learning')
export class LearningController {
  constructor(
    private readonly learning: LearningService,
    private readonly progress: ProgressService,
  ) {}

  @Get('enrollments')
  @ApiOperation({ summary: 'Мои зачисления' })
  async enrollments(@CurrentAuth() auth: AuthContext) {
    return this.learning.listEnrollments(auth.user.id);
  }

  @Get('enrollments/:enrollmentId')
  @ApiOperation({ summary: 'Карта курса: этапы, доступность и прогресс' })
  async courseMap(@CurrentAuth() auth: AuthContext, @Param('enrollmentId') enrollmentId: string) {
    await this.learning.assertOwnEnrollment(enrollmentId, auth.user.id);
    return this.learning.courseMap(enrollmentId);
  }

  @Get('enrollments/:enrollmentId/stages/:stageKey')
  @ApiOperation({ summary: 'Содержимое этапа' })
  async stage(
    @CurrentAuth() auth: AuthContext,
    @Param('enrollmentId') enrollmentId: string,
    @Param('stageKey') stageKey: string,
  ) {
    await this.learning.assertOwnEnrollment(enrollmentId, auth.user.id);
    return this.learning.stageDetails(enrollmentId, stageKey);
  }

  @Get('enrollments/:enrollmentId/lessons/:lessonKey')
  @ApiOperation({ summary: 'Урок с билетом на воспроизведение видео' })
  async lesson(
    @CurrentAuth() auth: AuthContext,
    @Param('enrollmentId') enrollmentId: string,
    @Param('lessonKey') lessonKey: string,
  ) {
    await this.learning.assertOwnEnrollment(enrollmentId, auth.user.id);
    return this.learning.lessonDetails(enrollmentId, lessonKey, auth.user.id);
  }

  @Put('enrollments/:enrollmentId/lessons/:lessonKey/progress')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Сохранение позиции просмотра' })
  async trackProgress(
    @CurrentAuth() auth: AuthContext,
    @Param('enrollmentId') enrollmentId: string,
    @Param('lessonKey') lessonKey: string,
    @Body(zodBody(watchProgressSchema)) body: { positionSec: number; percent: number },
  ): Promise<void> {
    await this.learning.assertOwnEnrollment(enrollmentId, auth.user.id);
    await this.progress.trackWatch(enrollmentId, lessonKey, body);
  }

  @Post('enrollments/:enrollmentId/lessons/:lessonKey/complete')
  @ApiOperation({ summary: 'Отметить урок пройденным' })
  async completeLesson(
    @CurrentAuth() auth: AuthContext,
    @Param('enrollmentId') enrollmentId: string,
    @Param('lessonKey') lessonKey: string,
  ) {
    await this.learning.assertOwnEnrollment(enrollmentId, auth.user.id);
    const progress = await this.progress.completeLesson(enrollmentId, lessonKey);
    return { completedAt: progress.completedAt?.toISOString() ?? null };
  }

  @Get('enrollments/:enrollmentId/lessons/:lessonKey/materials/:materialId/download')
  @ApiOperation({ summary: 'Подписанная ссылка на материал урока' })
  async downloadMaterial(
    @CurrentAuth() auth: AuthContext,
    @Param('enrollmentId') enrollmentId: string,
    @Param('lessonKey') lessonKey: string,
    @Param('materialId') materialId: string,
  ) {
    await this.learning.assertOwnEnrollment(enrollmentId, auth.user.id);
    return this.learning.materialDownloadUrl(
      enrollmentId,
      lessonKey,
      materialId,
      auth.user.id,
      auth.platformRoles,
    );
  }
}
