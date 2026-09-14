import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import { zodBody } from '@/common/pipes/zod-validation.pipe';
import { CurrentAuth, type AuthContext } from '@/modules/auth/decorators/auth.decorators';
import { ProgressService } from '@/modules/learning/progress/progress.service';
import { LearningService } from './learning.service';
import type { PlaybackCapabilities } from '@/infra/video/video.types';

const watchProgressSchema = z
  .object({
    positionSec: z.number().int().min(0).max(86_400),
    percent: z.number().int().min(0).max(100),
  })
  .strict();

/**
 * Что клиент умеет проигрывать. Проверяет он сам, до запроса сессии:
 * в Telegram WebView защищённое воспроизведение доступно не везде, и решение
 * о режиме принимает сервер, а не клиент.
 */
const playbackSchema = z
  .object({
    capabilities: z
      .object({
        widevine: z.boolean().default(false),
        fairplay: z.boolean().default(false),
        playready: z.boolean().default(false),
      })
      .strict()
      .default({ widevine: false, fairplay: false, playready: false }),
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
    return this.learning.lessonDetails(enrollmentId, lessonKey);
  }

  @Post('enrollments/:enrollmentId/lessons/:lessonKey/playback')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Сессия просмотра видео урока' })
  async playback(
    @CurrentAuth() auth: AuthContext,
    @Param('enrollmentId') enrollmentId: string,
    @Param('lessonKey') lessonKey: string,
    @Body(zodBody(playbackSchema)) body: { capabilities: PlaybackCapabilities },
    @Req() req: Request,
  ) {
    const forwarded = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim();
    const ticket = await this.learning.issuePlayback({
      enrollmentId,
      lessonKey,
      userId: auth.user.id,
      capabilities: body.capabilities,
      ip: forwarded ?? req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    });

    return {
      sessionId: ticket.sessionId,
      provider: ticket.provider,
      embedUrl: ticket.embedUrl,
      authToken: ticket.authToken,
      watermark: ticket.watermark,
      drm: ticket.drm,
      expiresAt: ticket.expiresAt.toISOString(),
    };
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
