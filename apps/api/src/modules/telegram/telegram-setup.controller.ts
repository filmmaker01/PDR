import {
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { AppConfigService } from '@/config/config.service';
import { Public } from '@/modules/auth/decorators/auth.decorators';
import {
  ALLOWED_UPDATES,
  BOT_COMMANDS,
  diffWebhook,
  maskUrlSecret,
  validateSetup,
  webhookUrl,
  type WebhookInfo,
} from '@/infra/telegram/setup-plan';

interface SetupReport {
  applied: boolean;
  bot: string | null;
  webhook: string | null;
  problems: string[];
  steps: string[];
}

/**
 * Настройка бота из самого развёрнутого приложения.
 *
 * Скрипт `telegram:setup` делает то же самое, но ему нужен токен бота в
 * окружении запускающего. На Vercel токен хранится только в переменных проекта
 * и наружу не выдаётся, а зайти в контейнер и выполнить там команду негде —
 * поэтому настройка доступна как защищённый эндпоинт.
 *
 * Решения (адрес вебхука, набор обновлений, список команд) не дублируются:
 * они берутся из того же модуля, что и скрипт, и покрыты его тестами.
 */
@ApiExcludeController()
@Controller('telegram/setup')
export class TelegramSetupController {
  constructor(private readonly config: AppConfigService) {}

  private assertCronSecret(req: Request): void {
    const expected = process.env.CRON_SECRET ?? '';
    if (!expected) throw new ForbiddenException('CRON_SECRET не задан');

    const header = req.headers.authorization ?? '';
    const provided = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new ForbiddenException('Неверный секрет');
    }
  }

  private async api<T>(method: string, payload?: unknown): Promise<T> {
    const token = this.config.env.TELEGRAM_BOT_TOKEN;
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload ?? {}),
    });
    const body = (await res.json()) as { ok: boolean; result?: T; description?: string };
    if (!body.ok) throw new Error(`${method}: ${body.description ?? 'ошибка Telegram'}`);
    return body.result as T;
  }

  @Get()
  @Public()
  @ApiExcludeController()
  async check(@Req() req: Request): Promise<SetupReport> {
    return this.run(req, false);
  }

  @Post()
  @Public()
  @HttpCode(HttpStatus.OK)
  async apply(@Req() req: Request): Promise<SetupReport> {
    return this.run(req, true);
  }

  private async run(req: Request, apply: boolean): Promise<SetupReport> {
    this.assertCronSecret(req);

    const env = {
      TELEGRAM_BOT_TOKEN: this.config.env.TELEGRAM_BOT_TOKEN,
      TELEGRAM_BOT_USERNAME: this.config.env.TELEGRAM_BOT_USERNAME,
      TELEGRAM_WEBHOOK_SECRET: this.config.env.TELEGRAM_WEBHOOK_SECRET,
      TELEGRAM_CLUB_CHAT_ID: this.config.env.TELEGRAM_CLUB_CHAT_ID,
      PUBLIC_API_URL: this.config.env.PUBLIC_API_URL,
      MINIAPP_URL: this.config.env.MINIAPP_URL,
    };

    const problems = validateSetup(env);
    const steps: string[] = [];
    if (problems.length > 0) {
      return { applied: false, bot: null, webhook: null, problems, steps };
    }

    const expectedUrl = webhookUrl(env.PUBLIC_API_URL, env.TELEGRAM_WEBHOOK_SECRET);

    const me = await this.api<{ id: number; username?: string }>('getMe');
    const bot = `@${me.username ?? '?'} (id ${me.id})`;
    if (me.username?.toLowerCase() !== env.TELEGRAM_BOT_USERNAME.toLowerCase()) {
      problems.push(
        `TELEGRAM_BOT_USERNAME=${env.TELEGRAM_BOT_USERNAME} не совпадает с @${me.username ?? '?'}`,
      );
    }

    if (apply) {
      await this.api('setWebhook', {
        url: expectedUrl,
        secret_token: env.TELEGRAM_WEBHOOK_SECRET,
        allowed_updates: ALLOWED_UPDATES,
        max_connections: 40,
      });
      steps.push('вебхук установлен');

      await this.api('setMyCommands', { commands: BOT_COMMANDS });
      steps.push('команды заданы');

      await this.api('setChatMenuButton', {
        menu_button: {
          type: 'web_app',
          text: 'Открыть',
          web_app: { url: env.MINIAPP_URL },
        },
      });
      steps.push('кнопка меню настроена');
    }

    const info = await this.api<WebhookInfo>('getWebhookInfo');
    problems.push(...diffWebhook(info, expectedUrl));
    if (info.pending_update_count) {
      steps.push(`в очереди обновлений: ${info.pending_update_count}`);
    }

    return {
      applied: apply,
      bot,
      webhook: maskUrlSecret(info.url ?? ''),
      problems,
      steps,
    };
  }
}
