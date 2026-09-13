import { Injectable, Logger } from '@nestjs/common';
import type { Notification, NotificationPreference, Prisma } from '@prisma/client';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { AppConfigService } from '@/config/config.service';
import { JobsService } from '@/infra/jobs/jobs.service';
import { JOB } from '@/infra/jobs/job-queue';
import { TelegramService } from '@/infra/telegram/telegram.service';
import { UsersService } from '@/modules/users/users.service';
import {
  PREFERENCE_BY_TYPE,
  buildButtons,
  renderNotification,
  type NotificationType,
} from './notification-templates';

export interface NotifyInput {
  userId: string;
  type: NotificationType;
  payload?: Record<string, unknown>;
  /** Ключ дедупликации: повторная постановка того же события не создаёт дубль. */
  dedupeKey?: string;
  /** Отложенная отправка (напоминания). */
  scheduledAt?: Date;
  /** Поставить в очередь внутри существующей транзакции. */
  tx?: Prisma.TransactionClient;
}

const DEFAULT_PREFERENCES = {
  reviewResults: true,
  stageUnlocked: true,
  appointmentReminders: true,
  orderAssigned: true,
  accessExpiring: true,
  reviewQueueDigest: true,
  reminderLeadMinutes: 60,
};

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly jobs: JobsService,
    private readonly telegram: TelegramService,
    private readonly users: UsersService,
  ) {}

  /**
   * Постановка уведомления в очередь.
   *
   * Запись создаётся в той же транзакции, что и бизнес-изменение (если передан tx),
   * поэтому не бывает «работа проверена, а уведомление потеряно». Сама отправка
   * идёт отдельно и её неудача никогда не откатывает основную операцию.
   */
  async notify(input: NotifyInput): Promise<Notification | null> {
    const client = input.tx ?? this.prisma;

    if (input.dedupeKey) {
      const existing = await client.notification.findUnique({
        where: { dedupeKey: input.dedupeKey },
        select: { id: true },
      });
      if (existing) return null;
    }

    const notification = await client.notification
      .create({
        data: {
          userId: input.userId,
          type: input.type,
          payload: (input.payload ?? {}) as Prisma.InputJsonValue,
          dedupeKey: input.dedupeKey ?? null,
          scheduledAt: input.scheduledAt ?? new Date(),
        },
      })
      .catch((err: unknown) => {
        // Гонка по dedupeKey: уведомление уже поставлено параллельно.
        this.logger.debug({ err, dedupeKey: input.dedupeKey }, 'Уведомление уже существует');
        return null;
      });

    if (!notification) return null;

    const delaySec = input.scheduledAt
      ? Math.max(0, Math.round((input.scheduledAt.getTime() - Date.now()) / 1000))
      : 0;

    await this.jobs.enqueue(
      JOB.notificationsSend,
      { notificationId: notification.id },
      {
        startAfterSec: delaySec || undefined,
        retryLimit: 5,
        retryDelaySec: 30,
        singletonKey: `notify:${notification.id}`,
      },
    );
    return notification;
  }

  /** Массовая постановка (дайджесты, истечение доступов). */
  async notifyMany(inputs: NotifyInput[]): Promise<number> {
    let created = 0;
    for (const input of inputs) {
      const result = await this.notify(input);
      if (result) created += 1;
    }
    return created;
  }

  async preferences(userId: string): Promise<NotificationPreference> {
    return this.prisma.notificationPreference.upsert({
      where: { userId },
      create: { userId, ...DEFAULT_PREFERENCES },
      update: {},
    });
  }

  async updatePreferences(
    userId: string,
    input: Partial<typeof DEFAULT_PREFERENCES>,
  ): Promise<NotificationPreference> {
    return this.prisma.notificationPreference.upsert({
      where: { userId },
      create: { userId, ...DEFAULT_PREFERENCES, ...input },
      update: input,
    });
  }

  /**
   * Отправка одного уведомления. Вызывается worker'ом.
   * Возвращает признак «нужно повторить»: очередь сама решит про повтор.
   */
  async send(notificationId: string): Promise<void> {
    const notification = await this.prisma.notification.findUnique({
      where: { id: notificationId },
      include: { user: true },
    });
    if (!notification || notification.status === 'sent' || notification.status === 'skipped')
      return;

    const user = notification.user;

    // Бот может писать только тем, кто сам начал диалог или дал разрешение.
    if (!user.botWriteAllowed || user.isBotBlocked) {
      await this.markSkipped(notificationId, 'бот не может писать пользователю');
      return;
    }

    const type = notification.type as NotificationType;
    const preferenceKey = PREFERENCE_BY_TYPE[type];
    if (preferenceKey) {
      const prefs = await this.preferences(user.id);
      if ((prefs as unknown as Record<string, boolean>)[preferenceKey] === false) {
        await this.markSkipped(notificationId, 'отключено в настройках пользователя');
        return;
      }
    }

    const rendered = renderNotification(
      type,
      (notification.payload ?? {}) as Record<string, unknown>,
    );
    const result = await this.telegram.sendMessage({
      chatId: user.telegramUserId.toString(),
      text: rendered.text,
      buttons: buildButtons(rendered, this.config.env.MINIAPP_URL),
    });

    if (result.ok) {
      await this.prisma.notification.update({
        where: { id: notificationId },
        data: {
          status: 'sent',
          sentAt: new Date(),
          telegramMessageId: BigInt(result.messageId),
          attempts: { increment: 1 },
        },
      });
      return;
    }

    await this.prisma.notification.update({
      where: { id: notificationId },
      data: { attempts: { increment: 1 }, error: result.error.slice(0, 500) },
    });

    if (result.kind === 'blocked') {
      await this.users.markBotBlocked(user.id);
      await this.markSkipped(notificationId, 'пользователь заблокировал бота');
      return;
    }
    if (result.kind === 'rate_limited') {
      // Пробрасываем ошибку: очередь повторит с задержкой.
      throw new Error(`Telegram ограничил частоту, повтор через ${result.retryAfterSec} с`);
    }
    if (result.error === 'telegram_disabled') {
      await this.markSkipped(notificationId, 'Telegram отключён в этом окружении');
      return;
    }
    throw new Error(result.error);
  }

  /** Пометить неудачным окончательно (исчерпаны повторы). */
  async markFailed(notificationId: string, error: string): Promise<void> {
    await this.prisma.notification.update({
      where: { id: notificationId },
      data: { status: 'failed', error: error.slice(0, 500) },
    });
  }

  private async markSkipped(notificationId: string, reason: string): Promise<void> {
    await this.prisma.notification.update({
      where: { id: notificationId },
      data: { status: 'skipped', error: reason },
    });
  }

  /** Отмена запланированного уведомления (например, запись перенесли). */
  async cancelByDedupeKey(dedupeKey: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { dedupeKey, status: 'queued' },
      data: { status: 'skipped', error: 'событие отменено или изменено' },
    });
  }

  async listForUser(userId: string, limit = 50): Promise<Notification[]> {
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async stats(): Promise<Record<string, number>> {
    const rows = await this.prisma.notification.groupBy({
      by: ['status'],
      _count: { _all: true },
      where: { createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) } },
    });
    return Object.fromEntries(rows.map((r) => [r.status, r._count._all]));
  }
}
