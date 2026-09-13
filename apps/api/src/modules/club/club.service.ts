import { Injectable, Logger } from '@nestjs/common';
import type { ClubMembership, ClubStatus, Prisma } from '@prisma/client';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { AppConfigService } from '@/config/config.service';
import { AppError } from '@/common/errors/app.error';
import { TelegramService } from '@/infra/telegram/telegram.service';
import { JobsService } from '@/infra/jobs/jobs.service';
import { JOB } from '@/infra/jobs/job-queue';
import { AccessService } from '@/modules/access/access.service';
import { NotificationsService } from '@/modules/notifications/notifications.service';

export interface ClubStatusView {
  hasAccess: boolean;
  validUntil: string | null;
  status: ClubStatus;
  joinedAt: string | null;
  /** Ссылка-заявка в группу: без действующего доступа заявка будет отклонена. */
  inviteLink: string | null;
  lastError: string | null;
}

/**
 * Закрытый клуб в Telegram.
 *
 * Состояние в нашей базе — отражение состояния в группе, а не его источник:
 * решение о членстве всегда принимается по действующему гранту, а расхождения
 * ловит ежедневная сверка.
 */
@Injectable()
export class ClubService {
  private readonly logger = new Logger(ClubService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly telegram: TelegramService,
    private readonly jobs: JobsService,
    private readonly access: AccessService,
    private readonly notifications: NotificationsService,
  ) {}

  get chatId(): string {
    return this.config.env.TELEGRAM_CLUB_CHAT_ID;
  }

  private get inviteLink(): string | null {
    return this.config.env.TELEGRAM_CLUB_INVITE_LINK || null;
  }

  async statusFor(userId: string): Promise<ClubStatusView> {
    const [membership, access] = await Promise.all([
      this.prisma.clubMembership.findUnique({ where: { userId } }),
      this.access.check({ product: 'club', userId }),
    ]);

    return {
      hasAccess: access.granted,
      validUntil: access.validUntil?.toISOString() ?? null,
      status: membership?.telegramStatus ?? 'none',
      joinedAt: membership?.joinedAt?.toISOString() ?? null,
      // Ссылку показываем только тем, кому есть смысл вступать.
      inviteLink: access.granted ? this.inviteLink : null,
      lastError: membership?.lastError ?? null,
    };
  }

  /** Заявка на вступление из Telegram: ставим задачу, решение принимает обработчик. */
  async onJoinRequest(telegramUserId: string, chatId: string): Promise<void> {
    if (chatId !== this.chatId) {
      this.logger.warn({ chatId }, 'Заявка в неизвестный чат, игнорируем');
      return;
    }

    const user = await this.prisma.user.findUnique({
      where: { telegramUserId: BigInt(telegramUserId) },
    });
    if (!user) {
      // Человек не открывал приложение: вступать ему не по чему.
      await this.record(null, 'join_request_unknown_user', { telegramUserId });
      await this.telegram.declineChatJoinRequest(chatId, telegramUserId);
      return;
    }

    await this.upsert(user.id, {
      telegramStatus: 'join_requested',
      joinRequestAt: new Date(),
      lastError: null,
    });
    await this.record(user.id, 'join_request', { telegramUserId });

    await this.jobs.enqueue(
      JOB.clubApprove,
      { userId: user.id, telegramUserId },
      { singletonKey: `club:approve:${user.id}` },
    );
  }

  /**
   * Решение по заявке. Единственный критерий — действующий грант клуба:
   * пересланная ссылка без доступа ничего не даёт.
   */
  async processJoinRequest(userId: string, telegramUserId: string): Promise<void> {
    const access = await this.access.check({ product: 'club', userId });

    if (!access.granted) {
      const result = await this.telegram.declineChatJoinRequest(this.chatId, telegramUserId);
      await this.upsert(userId, {
        telegramStatus: 'declined',
        lastError: result.ok ? null : result.error,
      });
      await this.record(userId, 'declined', { reason: 'no_access' });

      await this.notifications.notify({
        userId,
        type: 'club_removed',
        payload: { reason: 'no_access' },
        dedupeKey: `club_declined:${userId}:${new Date().toISOString().slice(0, 10)}`,
      });
      return;
    }

    const result = await this.telegram.approveChatJoinRequest(this.chatId, telegramUserId);
    if (!result.ok) {
      await this.upsert(userId, { telegramStatus: 'join_requested', lastError: result.error });
      await this.record(userId, 'error', { step: 'approve', error: result.error });
      // Ошибку пробрасываем: очередь повторит задачу.
      throw new Error(`Не удалось одобрить заявку: ${result.error}`);
    }

    await this.upsert(userId, {
      telegramStatus: 'member',
      accessGrantId: access.grant?.id ?? null,
      joinedAt: new Date(),
      removedAt: null,
      lastError: null,
    });
    await this.record(userId, 'approved', { grantId: access.grant?.id ?? null });
  }

  /** Исключение из клуба: кик с возможностью вернуться после продления. */
  async removeMember(userId: string, reason: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) return;

    const ban = await this.telegram.banChatMember(this.chatId, String(user.telegramUserId));
    if (!ban.ok && ban.kind !== 'failed') {
      await this.upsert(userId, { lastError: ban.error });
      await this.record(userId, 'error', { step: 'ban', error: ban.error });
      throw new Error(`Не удалось исключить из клуба: ${ban.error}`);
    }

    // Сразу снимаем бан: человек должен иметь возможность вернуться,
    // когда доступ продлят, — иначе вернуть его сможет только администратор.
    await this.telegram.unbanChatMember(this.chatId, String(user.telegramUserId));

    await this.upsert(userId, {
      telegramStatus: 'removed',
      removedAt: new Date(),
      accessGrantId: null,
      lastError: ban.ok ? null : ban.error,
    });
    await this.record(userId, 'removed', { reason });

    await this.notifications.notify({
      userId,
      type: 'club_removed',
      payload: { reason },
      dedupeKey: `club_removed:${userId}:${Date.now()}`,
    });
  }

  /** Событие `chat_member`: человек вышел сам или его удалили вручную. */
  async onChatMemberUpdate(telegramUserId: string, chatId: string, status: string): Promise<void> {
    if (chatId !== this.chatId) return;
    const user = await this.prisma.user.findUnique({
      where: { telegramUserId: BigInt(telegramUserId) },
    });
    if (!user) return;

    const mapped = this.mapStatus(status);
    await this.upsert(user.id, {
      telegramStatus: mapped,
      ...(mapped === 'member' ? { joinedAt: new Date(), removedAt: null } : {}),
      ...(mapped === 'left' || mapped === 'removed' ? { removedAt: new Date() } : {}),
    });
    await this.record(user.id, 'chat_member', { status });
  }

  /**
   * Ежедневная сверка: состоящие в клубе без действующего доступа выбывают,
   * расхождения со статусом в Telegram исправляются.
   */
  async audit(): Promise<{ checked: number; removed: number; fixed: number }> {
    const memberships = await this.prisma.clubMembership.findMany({
      where: { telegramStatus: { in: ['member', 'approved'] } },
      include: { user: { select: { id: true, telegramUserId: true } } },
    });

    let removed = 0;
    let fixed = 0;

    for (const membership of memberships) {
      const access = await this.access.check({ product: 'club', userId: membership.userId });
      if (!access.granted) {
        await this.jobs.enqueue(
          JOB.clubRemove,
          { userId: membership.userId, reason: 'access_ended' },
          { singletonKey: `club:remove:${membership.userId}` },
        );
        removed += 1;
        continue;
      }

      const status = await this.telegram.getChatMemberStatus(
        this.chatId,
        String(membership.user.telegramUserId),
      );
      if (!status) continue;
      const mapped = this.mapStatus(status);
      if (mapped !== membership.telegramStatus) {
        await this.upsert(membership.userId, { telegramStatus: mapped });
        await this.record(membership.userId, 'audit_fixed', { status });
        fixed += 1;
      }
    }

    return { checked: memberships.length, removed, fixed };
  }

  /** Следствие отзыва или истечения гранта клуба. */
  async onGrantEnded(userId: string, reason: string): Promise<void> {
    await this.jobs.enqueue(
      JOB.clubRemove,
      { userId, reason },
      { singletonKey: `club:remove:${userId}` },
    );
  }

  // ── Администрирование ─────────────────────────────────────────────────────

  async list(filter: { status?: ClubStatus; withErrors?: boolean; limit: number }) {
    return this.prisma.clubMembership.findMany({
      where: {
        ...(filter.status ? { telegramStatus: filter.status } : {}),
        ...(filter.withErrors ? { lastError: { not: null } } : {}),
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            username: true,
            telegramUserId: true,
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: filter.limit,
    });
  }

  async events(userId?: string, limit = 100) {
    return this.prisma.clubEvent.findMany({
      where: userId ? { userId } : {},
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { user: { select: { firstName: true, lastName: true, username: true } } },
    });
  }

  /** Ручное действие администратора: повторить одобрение. */
  async manualApprove(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw AppError.notFound('Пользователь не найден');
    await this.processJoinRequest(userId, String(user.telegramUserId));
  }

  async manualRemove(userId: string, reason: string): Promise<void> {
    await this.removeMember(userId, reason);
  }

  private mapStatus(status: string): ClubStatus {
    switch (status) {
      case 'member':
      case 'administrator':
      case 'creator':
        return 'member';
      case 'restricted':
        return 'member';
      case 'left':
        return 'left';
      case 'kicked':
        return 'removed';
      default:
        return 'none';
    }
  }

  private async upsert(
    userId: string,
    data: Partial<Omit<ClubMembership, 'id' | 'userId' | 'createdAt' | 'updatedAt'>>,
  ): Promise<void> {
    const payload = { ...data } as Prisma.ClubMembershipUncheckedUpdateInput;
    await this.prisma.clubMembership.upsert({
      where: { userId },
      create: {
        ...(payload as Omit<Prisma.ClubMembershipUncheckedCreateInput, 'userId' | 'chatId'>),
        userId,
        chatId: this.chatId,
      },
      update: payload,
    });
  }

  private async record(
    userId: string | null,
    event: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.clubEvent.create({
      data: { userId, event, payload: payload as Prisma.InputJsonValue },
    });
  }
}
