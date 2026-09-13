import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestApp, truncateAll, type TestApp } from './helpers/app';
import { createUser, createWorkspace, type TestUser } from './helpers/factories';
import { NotificationsService } from '@/modules/notifications/notifications.service';
import { TelegramService } from '@/infra/telegram/telegram.service';
import { AccessService } from '@/modules/access/access.service';
import type { SendResult } from '@/infra/telegram/telegram.types';

describe('уведомления', () => {
  let ctx: TestApp;
  let user: TestUser;
  const http = () => request(ctx.app.getHttpServer());

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    user = await createUser(ctx);
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await ctx.close();
  });

  function mockSend(result: SendResult) {
    return vi.spyOn(ctx.app.get(TelegramService), 'sendMessage').mockResolvedValue(result);
  }

  it('отправляет уведомление и запоминает идентификатор сообщения', async () => {
    const spy = mockSend({ ok: true, messageId: 555 });
    const notifications = ctx.app.get(NotificationsService);

    const created = await notifications.notify({
      userId: user.id,
      type: 'stage_unlocked',
      payload: { stageTitle: 'Этап 2', enrollmentId: 'e1', stageKey: 'stage-2' },
    });
    await notifications.send(created!.id);

    expect(spy).toHaveBeenCalledOnce();
    const text = spy.mock.calls[0]![0].text;
    expect(text).toContain('Открыт новый этап');
    expect(text).toContain('Этап 2');

    const stored = await ctx.prisma.notification.findUnique({ where: { id: created!.id } });
    expect(stored?.status).toBe('sent');
    expect(stored?.telegramMessageId).toBe(555n);
  });

  it('dedupeKey не даёт продублировать одно событие', async () => {
    const notifications = ctx.app.get(NotificationsService);
    const first = await notifications.notify({
      userId: user.id,
      type: 'stage_unlocked',
      dedupeKey: 'stage_unlocked:e1:stage-2',
    });
    const second = await notifications.notify({
      userId: user.id,
      type: 'stage_unlocked',
      dedupeKey: 'stage_unlocked:e1:stage-2',
    });

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(await ctx.prisma.notification.count()).toBe(1);
  });

  it('блокировка бота помечает пользователя и не роняет операцию', async () => {
    mockSend({ ok: false, kind: 'blocked', error: 'bot was blocked by the user' });
    const notifications = ctx.app.get(NotificationsService);

    const created = await notifications.notify({ userId: user.id, type: 'stage_unlocked' });
    await expect(notifications.send(created!.id)).resolves.toBeUndefined();

    const stored = await ctx.prisma.notification.findUnique({ where: { id: created!.id } });
    expect(stored?.status).toBe('skipped');
    const fresh = await ctx.prisma.user.findUnique({ where: { id: user.id } });
    expect(fresh?.isBotBlocked).toBe(true);
  });

  it('ограничение частоты приводит к повтору, а не к потере', async () => {
    mockSend({ ok: false, kind: 'rate_limited', retryAfterSec: 12, error: 'Too Many Requests' });
    const notifications = ctx.app.get(NotificationsService);

    const created = await notifications.notify({ userId: user.id, type: 'stage_unlocked' });
    await expect(notifications.send(created!.id)).rejects.toThrow(/повтор через 12/);

    const stored = await ctx.prisma.notification.findUnique({ where: { id: created!.id } });
    expect(stored?.status).toBe('queued');
    expect(stored?.attempts).toBe(1);
  });

  it('не пишет тем, кто не разрешил боту сообщения', async () => {
    const spy = mockSend({ ok: true, messageId: 1 });
    await ctx.prisma.user.update({ where: { id: user.id }, data: { botWriteAllowed: false } });

    const notifications = ctx.app.get(NotificationsService);
    const created = await notifications.notify({ userId: user.id, type: 'stage_unlocked' });
    await notifications.send(created!.id);

    expect(spy).not.toHaveBeenCalled();
    const stored = await ctx.prisma.notification.findUnique({ where: { id: created!.id } });
    expect(stored?.status).toBe('skipped');
  });

  it('учитывает выключенный тип в настройках пользователя', async () => {
    const spy = mockSend({ ok: true, messageId: 1 });
    await http()
      .patch('/v1/me/notifications')
      .set(...user.authHeader)
      .send({ stageUnlocked: false })
      .expect(200);

    const notifications = ctx.app.get(NotificationsService);
    const created = await notifications.notify({ userId: user.id, type: 'stage_unlocked' });
    await notifications.send(created!.id);

    expect(spy).not.toHaveBeenCalled();
  });

  it('существенные события приходят независимо от настроек', async () => {
    const spy = mockSend({ ok: true, messageId: 1 });
    await http()
      .patch('/v1/me/notifications')
      .set(...user.authHeader)
      .send({ stageUnlocked: false, reviewResults: false, accessExpiring: false })
      .expect(200);

    const notifications = ctx.app.get(NotificationsService);
    const created = await notifications.notify({
      userId: user.id,
      type: 'access_revoked',
      payload: { productLabel: 'Доступ к курсу', reason: 'неоплата' },
    });
    await notifications.send(created!.id);

    expect(spy).toHaveBeenCalledOnce();
  });

  it('отмена по dedupeKey убирает запланированное уведомление', async () => {
    const notifications = ctx.app.get(NotificationsService);
    await notifications.notify({
      userId: user.id,
      type: 'appointment_reminder',
      dedupeKey: 'reminder:appt-1:60',
      scheduledAt: new Date(Date.now() + 3600_000),
    });
    await notifications.cancelByDedupeKey('reminder:appt-1:60');

    const stored = await ctx.prisma.notification.findFirst({
      where: { dedupeKey: 'reminder:appt-1:60' },
    });
    expect(stored?.status).toBe('skipped');
  });

  it('предупреждает об истечении доступа за 7 и 1 день, но не повторяется', async () => {
    mockSend({ ok: true, messageId: 1 });
    const admin = await createUser(ctx, { platformRoles: ['admin'] });
    await ctx.prisma.accessGrant.create({
      data: {
        product: 'club',
        subjectType: 'user',
        userId: user.id,
        status: 'active',
        validFrom: new Date(Date.now() - 86_400_000),
        validUntil: new Date(Date.now() + 6.5 * 86_400_000),
        grantedById: admin.id,
      },
    });

    const { AccessExpireHandler } = await import('@/modules/access/jobs/access-expire.handler');
    const handler = ctx.app.get(AccessExpireHandler);
    await handler.handle();
    await handler.handle();

    const stored = await ctx.prisma.notification.findMany({ where: { type: 'access_expiring' } });
    expect(stored).toHaveLength(1);
    expect((stored[0]!.payload as { daysLeft: number }).daysLeft).toBe(7);
  });

  it('отзыв доступа уведомляет владельца доступа', async () => {
    mockSend({ ok: true, messageId: 1 });
    const admin = await createUser(ctx, { platformRoles: ['admin'] });
    const grant = await ctx.app.get(AccessService).create({
      product: 'club',
      userId: user.id,
      grantedById: admin.id,
    });

    await http()
      .post(`/v1/admin/access-grants/${grant.id}/revoke`)
      .set(...admin.authHeader)
      .send({ reason: 'неоплата' })
      .expect(201);

    const stored = await ctx.prisma.notification.findFirst({
      where: { userId: user.id, type: 'access_revoked' },
    });
    expect(stored).not.toBeNull();
  });
});

describe('журнал действий', () => {
  let ctx: TestApp;
  let admin: TestUser;
  const http = () => request(ctx.app.getHttpServer());

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    admin = await createUser(ctx, { platformRoles: ['admin'] });
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('записывает выдачу доступа с автором и контекстом', async () => {
    const target = await createUser(ctx);
    const created = await http()
      .post('/v1/admin/access-grants')
      .set(...admin.authHeader)
      .send({ product: 'club', userId: target.id, reason: 'оплата' })
      .expect(201);

    // Перехватчик пишет журнал после ответа.
    await new Promise((r) => setTimeout(r, 100));

    const res = await http()
      .get('/v1/admin/audit')
      .set(...admin.authHeader)
      .expect(200);
    const entry = res.body.items.find(
      (i: { entityType: string; action: string }) =>
        i.entityType === 'access_grant' && i.action === 'grant',
    );
    expect(entry).toBeDefined();
    expect(entry.entityId).toBe(created.body.id);
    expect(entry.actorUserId).toBe(admin.id);
    expect(entry.requestId).toBeTruthy();
  });

  it('записи мастерской в платформенном журнале маскируются', async () => {
    const owner = await createUser(ctx);
    const ws = await createWorkspace(ctx, { ownerUserId: owner.id });

    await http()
      .patch(`/v1/workspaces/${ws.id}`)
      .set(...owner.authHeader)
      .send({ name: 'Новое имя' })
      .expect(200);
    await new Promise((r) => setTimeout(r, 100));

    const platform = await http()
      .get('/v1/admin/audit')
      .set(...admin.authHeader)
      .expect(200);
    const entry = platform.body.items.find(
      (i: { workspaceId: string | null }) => i.workspaceId === ws.id,
    );
    expect(entry).toBeDefined();
    expect(entry.before).toBeNull();
    expect(entry.after).toEqual({ маскировано: 'данные мастерской скрыты' });

    // Владельцу мастерской журнал доступен полностью.
    const ownerLog = await http()
      .get(`/v1/workspaces/${ws.id}/audit`)
      .set(...owner.authHeader)
      .expect(200);
    expect(ownerLog.body.items.length).toBeGreaterThan(0);
  });

  it('журнал мастерской недоступен сотруднику и чужим', async () => {
    const owner = await createUser(ctx);
    const stranger = await createUser(ctx);
    const ws = await createWorkspace(ctx, { ownerUserId: owner.id });

    await http()
      .get(`/v1/workspaces/${ws.id}/audit`)
      .set(...stranger.authHeader)
      .expect(404);
    await http()
      .get(`/v1/workspaces/${ws.id}/audit`)
      .set(...admin.authHeader)
      .expect(404);
  });

  it('дашборд показывает состояние очереди и worker', async () => {
    const res = await http()
      .get('/v1/admin/dashboard')
      .set(...admin.authHeader)
      .expect(200);
    expect(res.body).toHaveProperty('users');
    expect(res.body).toHaveProperty('worker');
    expect(res.body.worker.alive).toBe(false);
  });
});
