import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestApp, truncateAll, type TestApp } from './helpers/app';
import { createUser, type TestUser } from './helpers/factories';
import { TelegramService } from '@/infra/telegram/telegram.service';
import { ClubService } from '@/modules/club/club.service';

const CLUB_CHAT_ID = '-1001234567890';

describe('закрытый клуб', () => {
  let ctx: TestApp;
  let admin: TestUser;
  let member: TestUser;
  const http = () => request(ctx.app.getHttpServer());

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    admin = await createUser(ctx, { firstName: 'Админ' });
    await ctx.prisma.platformRole.create({ data: { userId: admin.id, role: 'admin' } });
    member = await createUser(ctx, { firstName: 'Участник' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await ctx.close();
  });

  /** Телеграм в тестах выключен: подменяем ответы шлюза. */
  function mockTelegram(overrides: Partial<Record<string, unknown>> = {}) {
    const telegram = ctx.app.get(TelegramService);
    const ok = { ok: true as const, messageId: 1 };
    return {
      approve: vi
        .spyOn(telegram, 'approveChatJoinRequest')
        .mockResolvedValue((overrides.approve as typeof ok) ?? ok),
      decline: vi
        .spyOn(telegram, 'declineChatJoinRequest')
        .mockResolvedValue((overrides.decline as typeof ok) ?? ok),
      ban: vi
        .spyOn(telegram, 'banChatMember')
        .mockResolvedValue((overrides.ban as typeof ok) ?? ok),
      unban: vi.spyOn(telegram, 'unbanChatMember').mockResolvedValue(ok),
      status: vi
        .spyOn(telegram, 'getChatMemberStatus')
        .mockResolvedValue((overrides.status as string) ?? 'member'),
      send: vi.spyOn(telegram, 'sendMessage').mockResolvedValue(ok),
    };
  }

  async function grantClub(userId: string, validUntil: Date | null = null): Promise<string> {
    const grant = await ctx.prisma.accessGrant.create({
      data: {
        product: 'club',
        subjectType: 'user',
        userId,
        status: 'active',
        validFrom: new Date(Date.now() - 86_400_000),
        validUntil,
        grantedById: admin.id,
      },
    });
    return grant.id;
  }

  describe('заявка на вступление', () => {
    it('одобряет заявку при действующем доступе', async () => {
      const telegram = mockTelegram();
      await grantClub(member.id);

      const club = ctx.app.get(ClubService);
      await club.onJoinRequest(String(member.telegramUserId), CLUB_CHAT_ID);
      await club.processJoinRequest(member.id, String(member.telegramUserId));

      expect(telegram.approve).toHaveBeenCalled();
      const membership = await ctx.prisma.clubMembership.findUnique({
        where: { userId: member.id },
      });
      expect(membership?.telegramStatus).toBe('member');
      expect(membership?.joinedAt).not.toBeNull();
    });

    it('отклоняет заявку без доступа', async () => {
      const telegram = mockTelegram();
      const club = ctx.app.get(ClubService);

      await club.onJoinRequest(String(member.telegramUserId), CLUB_CHAT_ID);
      await club.processJoinRequest(member.id, String(member.telegramUserId));

      expect(telegram.decline).toHaveBeenCalled();
      expect(telegram.approve).not.toHaveBeenCalled();
      const membership = await ctx.prisma.clubMembership.findUnique({
        where: { userId: member.id },
      });
      expect(membership?.telegramStatus).toBe('declined');
    });

    it('заявку незнакомого пользователя отклоняет сразу', async () => {
      const telegram = mockTelegram();
      const club = ctx.app.get(ClubService);

      await club.onJoinRequest('999999999', CLUB_CHAT_ID);

      expect(telegram.decline).toHaveBeenCalled();
      const events = await ctx.prisma.clubEvent.findMany();
      expect(events[0].event).toBe('join_request_unknown_user');
    });

    it('заявка в чужой чат игнорируется', async () => {
      const telegram = mockTelegram();
      const club = ctx.app.get(ClubService);

      await club.onJoinRequest(String(member.telegramUserId), '-100999');

      expect(telegram.decline).not.toHaveBeenCalled();
      expect(await ctx.prisma.clubEvent.count()).toBe(0);
    });

    it('ошибка Telegram при одобрении оставляет заявку и пробрасывается в очередь', async () => {
      mockTelegram({ approve: { ok: false, kind: 'failed', error: 'chat not found' } });
      await grantClub(member.id);
      const club = ctx.app.get(ClubService);

      await expect(
        club.processJoinRequest(member.id, String(member.telegramUserId)),
      ).rejects.toThrow();

      const membership = await ctx.prisma.clubMembership.findUnique({
        where: { userId: member.id },
      });
      expect(membership?.lastError).toBe('chat not found');
    });
  });

  describe('исключение', () => {
    it('исключает и сразу снимает бан, чтобы можно было вернуться', async () => {
      const telegram = mockTelegram();
      await grantClub(member.id);
      const club = ctx.app.get(ClubService);
      await club.processJoinRequest(member.id, String(member.telegramUserId));

      await club.removeMember(member.id, 'access_ended');

      expect(telegram.ban).toHaveBeenCalled();
      expect(telegram.unban).toHaveBeenCalled();
      const membership = await ctx.prisma.clubMembership.findUnique({
        where: { userId: member.id },
      });
      expect(membership?.telegramStatus).toBe('removed');
      expect(membership?.removedAt).not.toBeNull();

      const notification = await ctx.prisma.notification.findFirst({
        where: { userId: member.id, type: 'club_removed' },
      });
      expect(notification).not.toBeNull();
    });

    it('отзыв доступа администратором исключает из клуба', async () => {
      mockTelegram();
      const grantId = await grantClub(member.id);
      const club = ctx.app.get(ClubService);
      await club.processJoinRequest(member.id, String(member.telegramUserId));

      await http()
        .post(`/v1/admin/access-grants/${grantId}/revoke`)
        .set(...admin.authHeader)
        .send({ reason: 'Не продлил' })
        .expect(201);

      // Очередь в тестах отключена, поэтому выполняем задачу напрямую.
      await club.removeMember(member.id, 'access_revoked');

      const membership = await ctx.prisma.clubMembership.findUnique({
        where: { userId: member.id },
      });
      expect(membership?.telegramStatus).toBe('removed');
    });

    it('после продления доступа вступление снова возможно', async () => {
      const telegram = mockTelegram();
      await grantClub(member.id, new Date(Date.now() - 3_600_000));
      const club = ctx.app.get(ClubService);

      await club.processJoinRequest(member.id, String(member.telegramUserId));
      expect(telegram.decline).toHaveBeenCalled();

      await ctx.prisma.accessGrant.updateMany({
        where: { userId: member.id, product: 'club' },
        data: { status: 'active', validUntil: new Date(Date.now() + 30 * 86_400_000) },
      });

      await club.processJoinRequest(member.id, String(member.telegramUserId));
      expect(telegram.approve).toHaveBeenCalled();
      const membership = await ctx.prisma.clubMembership.findUnique({
        where: { userId: member.id },
      });
      expect(membership?.telegramStatus).toBe('member');
    });
  });

  describe('состояние и сверка', () => {
    it('показывает пользователю ссылку только при действующем доступе', async () => {
      const withoutAccess = await http()
        .get('/v1/club/status')
        .set(...member.authHeader)
        .expect(200);
      expect(withoutAccess.body.hasAccess).toBe(false);
      expect(withoutAccess.body.inviteLink).toBeNull();

      await grantClub(member.id);

      const withAccess = await http()
        .get('/v1/club/status')
        .set(...member.authHeader)
        .expect(200);
      expect(withAccess.body.hasAccess).toBe(true);
      expect(withAccess.body.inviteLink).toContain('t.me');
    });

    it('событие chat_member обновляет статус', async () => {
      mockTelegram();
      await grantClub(member.id);
      const club = ctx.app.get(ClubService);
      await club.processJoinRequest(member.id, String(member.telegramUserId));

      await club.onChatMemberUpdate(String(member.telegramUserId), CLUB_CHAT_ID, 'left');

      const membership = await ctx.prisma.clubMembership.findUnique({
        where: { userId: member.id },
      });
      expect(membership?.telegramStatus).toBe('left');
    });

    it('сверка ставит исключение для членства без доступа', async () => {
      mockTelegram();
      const club = ctx.app.get(ClubService);
      await grantClub(member.id);
      await club.processJoinRequest(member.id, String(member.telegramUserId));

      await ctx.prisma.accessGrant.updateMany({
        where: { userId: member.id, product: 'club' },
        data: { status: 'revoked' },
      });

      const result = await club.audit();
      expect(result.checked).toBe(1);
      expect(result.removed).toBe(1);
    });

    it('сверка исправляет расхождение статуса', async () => {
      const telegram = mockTelegram();
      const club = ctx.app.get(ClubService);
      await grantClub(member.id);
      await club.processJoinRequest(member.id, String(member.telegramUserId));

      telegram.status.mockResolvedValue('left');
      const result = await club.audit();
      expect(result.fixed).toBe(1);

      const membership = await ctx.prisma.clubMembership.findUnique({
        where: { userId: member.id },
      });
      expect(membership?.telegramStatus).toBe('left');
    });
  });

  describe('админка', () => {
    it('показывает членства и события', async () => {
      mockTelegram();
      await grantClub(member.id);
      await ctx.app.get(ClubService).processJoinRequest(member.id, String(member.telegramUserId));

      const memberships = await http()
        .get('/v1/admin/club/memberships')
        .set(...admin.authHeader)
        .expect(200);
      expect(memberships.body).toHaveLength(1);
      expect(memberships.body[0].status).toBe('member');

      const events = await http()
        .get('/v1/admin/club/events')
        .set(...admin.authHeader)
        .expect(200);
      expect(events.body.some((e: { event: string }) => e.event === 'approved')).toBe(true);
    });

    it('ручное исключение доступно администратору и закрыто остальным', async () => {
      mockTelegram();
      await grantClub(member.id);
      await ctx.app.get(ClubService).processJoinRequest(member.id, String(member.telegramUserId));

      await http()
        .post(`/v1/admin/club/memberships/${member.id}/remove`)
        .set(...member.authHeader)
        .send({ reason: 'сам себя' })
        .expect(403);

      await http()
        .post(`/v1/admin/club/memberships/${member.id}/remove`)
        .set(...admin.authHeader)
        .send({ reason: 'Нарушение правил' })
        .expect(204);

      const membership = await ctx.prisma.clubMembership.findUnique({
        where: { userId: member.id },
      });
      expect(membership?.telegramStatus).toBe('removed');
    });
  });
});
