import { Body, Controller, Headers, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Update } from 'grammy/types';
import { timingSafeEqual } from 'node:crypto';
import { AppConfigService } from '@/config/config.service';
import { AppError } from '@/common/errors/app.error';
import { Public } from '@/modules/auth/decorators/auth.decorators';
import { TelegramUpdateService } from './telegram-update.service';

function safeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

@ApiExcludeController()
@Controller('telegram')
export class TelegramController {
  constructor(
    private readonly config: AppConfigService,
    private readonly updates: TelegramUpdateService,
  ) {}

  /**
   * Вебхук Telegram. Секрет проверяется дважды: в пути и в заголовке,
   * который Telegram присылает сам.
   */
  @Post('webhook/:secret')
  @Public()
  @HttpCode(HttpStatus.OK)
  async webhook(
    @Param('secret') secret: string,
    @Headers('x-telegram-bot-api-secret-token') headerSecret: string | undefined,
    @Body() update: Update,
  ): Promise<{ ok: true }> {
    const expected = this.config.env.TELEGRAM_WEBHOOK_SECRET;
    if (!expected || !safeEquals(secret, expected) || !safeEquals(headerSecret ?? '', expected)) {
      throw AppError.forbidden('Неверный секрет вебхука');
    }

    // Telegram повторяет доставку при любом ответе, кроме 2xx,
    // поэтому обработка не должна ронять ответ.
    await this.updates.handle(update).catch(() => undefined);
    return { ok: true };
  }
}
