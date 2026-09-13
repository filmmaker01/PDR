import { Injectable, Logger } from '@nestjs/common';
import { Api, type RawApi } from 'grammy';
import { GrammyError, HttpError } from 'grammy';
import { AppConfigService } from '@/config/config.service';
import type { SendMessageInput, SendResult, TelegramGateway } from './telegram.types';

const BLOCKED_PATTERNS = [
  'bot was blocked by the user',
  'user is deactivated',
  'chat not found',
  "bot can't initiate conversation",
  'have no rights to send a message',
];

/**
 * Клиент Bot API. При TELEGRAM_ENABLED=false все вызовы становятся no-op,
 * чтобы разработка и тесты не зависели от внешнего сервиса.
 */
@Injectable()
export class TelegramService implements TelegramGateway {
  private readonly logger = new Logger(TelegramService.name);
  private readonly api: Api<RawApi> | null;

  constructor(private readonly config: AppConfigService) {
    this.api = config.env.TELEGRAM_ENABLED ? new Api(config.env.TELEGRAM_BOT_TOKEN) : null;
  }

  get enabled(): boolean {
    return this.api !== null;
  }

  get botUsername(): string {
    return this.config.env.TELEGRAM_BOT_USERNAME;
  }

  get clubChatId(): string {
    return this.config.env.TELEGRAM_CLUB_CHAT_ID;
  }

  async sendMessage(input: SendMessageInput): Promise<SendResult> {
    if (!this.api) {
      this.logger.debug({ chatId: input.chatId }, 'Telegram отключён, сообщение не отправлено');
      return { ok: false, kind: 'failed', error: 'telegram_disabled' };
    }
    return this.call(async () => {
      const message = await this.api!.sendMessage(input.chatId, input.text, {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: input.disablePreview ?? true },
        reply_markup: input.buttons
          ? {
              inline_keyboard: input.buttons.map((row) =>
                row.map((b) => {
                  if (b.webAppUrl) return { text: b.text, web_app: { url: b.webAppUrl } };
                  if (b.url) return { text: b.text, url: b.url };
                  return { text: b.text, callback_data: b.callbackData ?? 'noop' };
                }),
              ),
            }
          : undefined,
      });
      return { ok: true as const, messageId: message.message_id };
    });
  }

  async answerCallbackQuery(id: string, text?: string): Promise<void> {
    if (!this.api) return;
    await this.api.answerCallbackQuery(id, text ? { text } : undefined).catch((err: unknown) => {
      this.logger.warn({ err }, 'Не удалось ответить на callback');
    });
  }

  async approveChatJoinRequest(
    chatId: string | number,
    userId: string | number,
  ): Promise<SendResult> {
    if (!this.api) return { ok: false, kind: 'failed', error: 'telegram_disabled' };
    return this.call(async () => {
      await this.api!.approveChatJoinRequest(chatId, Number(userId));
      return { ok: true as const, messageId: 0 };
    });
  }

  async declineChatJoinRequest(
    chatId: string | number,
    userId: string | number,
  ): Promise<SendResult> {
    if (!this.api) return { ok: false, kind: 'failed', error: 'telegram_disabled' };
    return this.call(async () => {
      await this.api!.declineChatJoinRequest(chatId, Number(userId));
      return { ok: true as const, messageId: 0 };
    });
  }

  async banChatMember(chatId: string | number, userId: string | number): Promise<SendResult> {
    if (!this.api) return { ok: false, kind: 'failed', error: 'telegram_disabled' };
    return this.call(async () => {
      await this.api!.banChatMember(chatId, Number(userId));
      return { ok: true as const, messageId: 0 };
    });
  }

  async unbanChatMember(chatId: string | number, userId: string | number): Promise<SendResult> {
    if (!this.api) return { ok: false, kind: 'failed', error: 'telegram_disabled' };
    return this.call(async () => {
      await this.api!.unbanChatMember(chatId, Number(userId), { only_if_banned: true });
      return { ok: true as const, messageId: 0 };
    });
  }

  async getChatMemberStatus(
    chatId: string | number,
    userId: string | number,
  ): Promise<string | null> {
    if (!this.api) return null;
    try {
      const member = await this.api.getChatMember(chatId, Number(userId));
      return member.status;
    } catch {
      return null;
    }
  }

  async createChatInviteLink(chatId: string | number, name: string): Promise<string | null> {
    if (!this.api) return null;
    try {
      const link = await this.api.createChatInviteLink(chatId, {
        name,
        creates_join_request: true,
      });
      return link.invite_link;
    } catch (err) {
      this.logger.error({ err }, 'Не удалось создать ссылку-приглашение');
      return null;
    }
  }

  /** Классификация ошибок Bot API: блокировка, лимит, прочее. */
  private async call(fn: () => Promise<SendResult>): Promise<SendResult> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof GrammyError) {
        const description = err.description.toLowerCase();
        if (err.error_code === 429) {
          const retryAfter = err.parameters?.retry_after ?? 30;
          return {
            ok: false,
            kind: 'rate_limited',
            retryAfterSec: retryAfter,
            error: err.description,
          };
        }
        if (
          err.error_code === 403 ||
          BLOCKED_PATTERNS.some((pattern) => description.includes(pattern))
        ) {
          return { ok: false, kind: 'blocked', error: err.description };
        }
        return { ok: false, kind: 'failed', error: `${err.error_code}: ${err.description}` };
      }
      if (err instanceof HttpError) {
        return { ok: false, kind: 'failed', error: `network: ${String(err.error)}` };
      }
      return { ok: false, kind: 'failed', error: (err as Error).message };
    }
  }

  /** Ссылка на Mini App с параметром запуска. */
  miniAppLink(startParam?: string): string {
    const base = `https://t.me/${this.botUsername}/app`;
    return startParam ? `${base}?startapp=${encodeURIComponent(startParam)}` : base;
  }

  /** Ссылка на диалог с ботом с параметром /start. */
  botLink(startParam?: string): string {
    const base = `https://t.me/${this.botUsername}`;
    return startParam ? `${base}?start=${encodeURIComponent(startParam)}` : base;
  }
}
