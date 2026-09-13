import { Injectable, Logger } from '@nestjs/common';
import type { Update } from 'grammy/types';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { AppConfigService } from '@/config/config.service';
import { TelegramService } from '@/infra/telegram/telegram.service';
import { UsersService } from '@/modules/users/users.service';
import { AuthService } from '@/modules/auth/auth.service';

const START_HELP = [
  'Это приложение для PDR-мастеров: обучение и учёт заказов.',
  '',
  'Нажмите кнопку ниже, чтобы открыть приложение.',
].join('\n');

/**
 * Обработка обновлений Telegram.
 * Бот — не интерфейс продукта: он открывает Mini App, подтверждает вход
 * в админку и обслуживает заявки в клуб.
 */
@Injectable()
export class TelegramUpdateService {
  private readonly logger = new Logger(TelegramUpdateService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly telegram: TelegramService,
    private readonly users: UsersService,
    private readonly auth: AuthService,
  ) {}

  /** Защита от повторной доставки одного и того же обновления. */
  private async isDuplicate(updateId: number): Promise<boolean> {
    try {
      await this.prisma.telegramUpdate.create({ data: { updateId: BigInt(updateId) } });
      return false;
    } catch {
      return true;
    }
  }

  async handle(update: Update): Promise<void> {
    if (await this.isDuplicate(update.update_id)) {
      this.logger.debug({ updateId: update.update_id }, 'Повторная доставка обновления, пропуск');
      return;
    }

    if (update.message?.text) {
      await this.handleMessage(update.message);
      return;
    }
    if (update.callback_query) {
      await this.handleCallback(update.callback_query);
      return;
    }
    this.logger.debug({ keys: Object.keys(update) }, 'Обновление без обработчика');
  }

  private async handleMessage(message: NonNullable<Update['message']>): Promise<void> {
    const from = message.from;
    if (!from || from.is_bot) return;

    // Пользователь написал боту сам — значит, боту можно писать ему.
    const user = await this.users.upsertFromTelegram({
      id: String(from.id),
      firstName: from.first_name,
      lastName: from.last_name ?? null,
      username: from.username ?? null,
      languageCode: from.language_code ?? null,
      photoUrl: null,
      allowsWriteToPm: true,
      isPremium: false,
    });

    const text = message.text ?? '';
    const startParam = text.startsWith('/start') ? text.slice('/start'.length).trim() : null;

    if (startParam?.startsWith('login_')) {
      await this.offerWebLogin(user.id, message.chat.id, startParam.slice('login_'.length));
      return;
    }

    if (startParam?.startsWith('inv_')) {
      await this.telegram.sendMessage({
        chatId: message.chat.id,
        text: 'Вас пригласили в мастерскую. Откройте приложение, чтобы принять приглашение.',
        buttons: [[{ text: 'Открыть приложение', webAppUrl: this.config.env.MINIAPP_URL }]],
      });
      return;
    }

    await this.telegram.sendMessage({
      chatId: message.chat.id,
      text: START_HELP,
      buttons: [[{ text: 'Открыть приложение', webAppUrl: this.config.env.MINIAPP_URL }]],
    });
  }

  private async offerWebLogin(userId: string, chatId: number, code: string): Promise<void> {
    const request = await this.prisma.webLoginRequest.findUnique({ where: { code } });
    if (!request || request.status !== 'pending' || request.expiresAt.getTime() <= Date.now()) {
      await this.telegram.sendMessage({
        chatId,
        text: 'Запрос на вход не найден или устарел. Повторите попытку на странице входа.',
      });
      return;
    }

    const roles = await this.users.platformRoles(userId);
    if (roles.length === 0) {
      await this.telegram.sendMessage({
        chatId,
        text: 'У вас нет доступа к панели администратора.',
      });
      return;
    }

    await this.telegram.sendMessage({
      chatId,
      text: [
        '<b>Подтверждение входа в панель администратора</b>',
        '',
        `Устройство: ${request.userAgent ? escapeHtml(request.userAgent.slice(0, 120)) : 'неизвестно'}`,
        request.ip ? `Адрес: ${escapeHtml(request.ip)}` : '',
        '',
        'Если это были не вы, просто проигнорируйте сообщение.',
      ]
        .filter(Boolean)
        .join('\n'),
      buttons: [
        [
          { text: 'Подтвердить вход', callbackData: `weblogin:${code}` },
          { text: 'Это не я', callbackData: `weblogin_deny:${code}` },
        ],
      ],
    });
  }

  private async handleCallback(query: NonNullable<Update['callback_query']>): Promise<void> {
    const data = query.data ?? '';
    const from = query.from;

    if (data.startsWith('weblogin:') || data.startsWith('weblogin_deny:')) {
      const denied = data.startsWith('weblogin_deny:');
      const code = data.slice(data.indexOf(':') + 1);
      const user = await this.users.findByTelegramId(BigInt(from.id));

      if (!user) {
        await this.telegram.answerCallbackQuery(query.id, 'Пользователь не найден');
        return;
      }
      if (denied) {
        await this.prisma.webLoginRequest
          .updateMany({ where: { code, status: 'pending' }, data: { status: 'expired' } })
          .catch(() => undefined);
        await this.telegram.answerCallbackQuery(query.id, 'Вход отклонён');
        return;
      }

      try {
        await this.auth.confirmWebLoginRequest(code, user.id);
        await this.telegram.answerCallbackQuery(query.id, 'Вход подтверждён');
      } catch (err) {
        this.logger.warn({ err }, 'Не удалось подтвердить вход');
        await this.telegram.answerCallbackQuery(query.id, 'Запрос устарел или недоступен');
      }
      return;
    }

    await this.telegram.answerCallbackQuery(query.id);
  }
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
