import { Body, Controller, HttpCode, HttpStatus, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { zodBody } from '@/common/pipes/zod-validation.pipe';
import { RateLimit, RateLimitGuard } from '@/common/guards/rate-limit.guard';
import { Public } from '@/modules/auth/decorators/auth.decorators';
import { StageAccessService } from '@/modules/learning/progress/stage-access.service';
import { AppConfigService } from '@/config/config.service';
import { VideoSessionService } from './video-session.service';

/**
 * Токен приходит по-разному в зависимости от того, как настроен провайдер,
 * поэтому принимаются несколько привычных имён поля. Лишние поля не
 * запрещаются: провайдер волен присылать свою служебную нагрузку.
 */
const authorizeSchema = z
  .object({
    token: z.string().min(1).max(4096).optional(),
    drmauthtoken: z.string().min(1).max(4096).optional(),
    user_id: z.string().max(4096).optional(),
    video_id: z.string().max(256).optional(),
  })
  .passthrough();

/**
 * Проверка права на воспроизведение.
 *
 * Сюда стучится видеопровайдер каждый раз, когда плееру нужна лицензия.
 * Ответ 200 разрешает просмотр, 403 запрещает. Права проверяются заново по
 * базе: между выдачей токена и этим запросом доступ мог закончиться, а этап —
 * закрыться.
 */
@ApiExcludeController()
@Controller('video')
@UseGuards(RateLimitGuard)
export class VideoAuthorizeController {
  constructor(
    private readonly sessions: VideoSessionService,
    private readonly stageAccess: StageAccessService,
    private readonly config: AppConfigService,
  ) {}

  @Post('authorize')
  @Public()
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 600, windowSec: 60 })
  async authorize(
    @Body(zodBody(authorizeSchema)) body: Record<string, unknown>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ allowed: boolean; reason?: string }> {
    // Общий секрет: запрос должен прийти от провайдера, а не от того, кто
    // подобрал адрес. Конкретный способ подписи у провайдера надо сверить —
    // пока проверяется заголовок, который задаётся в его настройках.
    const expected = this.config.env.VIDEO_AUTH_CALLBACK_SECRET;
    if (expected) {
      const got = req.headers['x-auth-secret'] ?? req.headers['authorization'];
      const value = Array.isArray(got) ? got[0] : got;
      if (value?.replace(/^Bearer\s+/i, '') !== expected) {
        res.status(HttpStatus.FORBIDDEN);
        return { allowed: false, reason: 'bad_caller' };
      }
    }

    const token = (body.token ?? body.drmauthtoken ?? body.user_id) as string | undefined;
    if (!token) {
      res.status(HttpStatus.FORBIDDEN);
      return { allowed: false, reason: 'no_token' };
    }

    const forwarded = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim();
    const outcome = await this.sessions.authorize(
      token,
      { ip: forwarded ?? req.ip ?? null, userAgent: req.headers['user-agent'] ?? null },
      // Повторная проверка прав: доступ к курсу и открытость этапа.
      async (session) => {
        const ctx = await this.stageAccess.loadContext(session.enrollmentId).catch(() => null);
        if (!ctx) return false;
        const stageKey = this.stageAccess.stageKeyOfLesson(ctx.version, session.lessonKey);
        if (!stageKey) return false;
        const access = await this.stageAccess.getStageAccess(session.enrollmentId, stageKey);
        return access.status !== 'locked';
      },
    );

    if (!outcome.allowed) {
      res.status(HttpStatus.FORBIDDEN);
      return { allowed: false, reason: outcome.reason };
    }
    return { allowed: true };
  }
}
