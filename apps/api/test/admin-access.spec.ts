import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, truncateAll, type TestApp } from './helpers/app';
import { createUser, createWorkspace, type TestUser } from './helpers/factories';
import { AccessService } from '@/modules/access/access.service';

describe('администрирование доступов', () => {
  let ctx: TestApp;
  let admin: TestUser;
  let plain: TestUser;
  const http = () => request(ctx.app.getHttpServer());

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    admin = await createUser(ctx, { platformRoles: ['admin'] });
    plain = await createUser(ctx);
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('обычный пользователь не попадает в админские разделы', async () => {
    for (const path of ['/v1/admin/access-grants', '/v1/admin/users', '/v1/admin/workspaces']) {
      const res = await http()
        .get(path)
        .set(...plain.authHeader)
        .expect(403);
      expect(res.body.error.code).toBe('platform_role_required');
    }
  });

  it('куратор не получает прав администратора', async () => {
    const curator = await createUser(ctx, { platformRoles: ['curator'] });
    await http()
      .get('/v1/admin/access-grants')
      .set(...curator.authHeader)
      .expect(403);
  });

  it('выдача доступа к клубу и немедленное действие', async () => {
    const res = await http()
      .post('/v1/admin/access-grants')
      .set(...admin.authHeader)
      .send({ product: 'club', userId: plain.id, reason: 'оплата 12.11' })
      .expect(201);

    expect(res.body.status).toBe('active');
    const me = await http()
      .get('/v1/me')
      .set(...plain.authHeader)
      .expect(200);
    expect(me.body.club.hasAccess).toBe(true);
  });

  it('доступ к CRM нельзя выдать пользователю, а к клубу — мастерской', async () => {
    const ws = await createWorkspace(ctx, { ownerUserId: plain.id, withAccess: false });

    await http()
      .post('/v1/admin/access-grants')
      .set(...admin.authHeader)
      .send({ product: 'crm', userId: plain.id })
      .expect(422);

    await http()
      .post('/v1/admin/access-grants')
      .set(...admin.authHeader)
      .send({ product: 'club', workspaceId: ws.id })
      .expect(422);

    await http()
      .post('/v1/admin/access-grants')
      .set(...admin.authHeader)
      .send({ product: 'crm', workspaceId: ws.id })
      .expect(201);
  });

  it('доступ к курсу требует курс', async () => {
    await http()
      .post('/v1/admin/access-grants')
      .set(...admin.authHeader)
      .send({ product: 'course', userId: plain.id })
      .expect(422);
  });

  it('продление меняет срок текущего доступа, а не плодит новые', async () => {
    const ws = await createWorkspace(ctx, {
      ownerUserId: plain.id,
      validUntil: new Date(Date.now() + 86_400_000),
    });

    const until = new Date(Date.now() + 30 * 86_400_000);
    await http()
      .post(`/v1/admin/access-grants/${ws.grantId}/extend`)
      .set(...admin.authHeader)
      .send({ validUntil: until.toISOString(), reason: 'продление на месяц' })
      .expect(201);

    const grants = await ctx.prisma.accessGrant.findMany({ where: { workspaceId: ws.id } });
    expect(grants).toHaveLength(1);
    expect(grants[0]!.validUntil!.getTime()).toBeCloseTo(until.getTime(), -3);
  });

  it('отзыв и возобновление доступа', async () => {
    const ws = await createWorkspace(ctx, { ownerUserId: plain.id });

    await http()
      .post(`/v1/admin/access-grants/${ws.grantId}/revoke`)
      .set(...admin.authHeader)
      .send({ reason: 'неоплата' })
      .expect(201);

    await http()
      .patch(`/v1/workspaces/${ws.id}`)
      .set(...plain.authHeader)
      .send({ name: 'Нельзя' })
      .expect(403);

    await http()
      .post(`/v1/admin/access-grants/${ws.grantId}/resume`)
      .set(...admin.authHeader)
      .send({ reason: 'оплата получена' })
      .expect(201);

    await http()
      .patch(`/v1/workspaces/${ws.id}`)
      .set(...plain.authHeader)
      .send({ name: 'Снова можно' })
      .expect(200);
  });

  it('фоновая задача переводит просроченные доступы в expired', async () => {
    await ctx.prisma.accessGrant.create({
      data: {
        product: 'club',
        subjectType: 'user',
        userId: plain.id,
        status: 'active',
        validFrom: new Date(Date.now() - 10 * 86_400_000),
        validUntil: new Date(Date.now() - 3600_000),
        grantedById: admin.id,
      },
    });

    const expired = await ctx.app.get(AccessService).expireOutdated();
    expect(expired).toHaveLength(1);

    const stored = await ctx.prisma.accessGrant.findFirst({ where: { userId: plain.id } });
    expect(stored?.status).toBe('expired');
  });

  it('создание мастерской с владельцем и выдача доступа', async () => {
    const created = await http()
      .post('/v1/admin/workspaces')
      .set(...admin.authHeader)
      .send({ name: 'Мастерская Иванова', ownerUserId: plain.id, timezone: 'Asia/Krasnoyarsk' })
      .expect(201);

    await http()
      .post('/v1/admin/access-grants')
      .set(...admin.authHeader)
      .send({ product: 'crm', workspaceId: created.body.id, reason: 'пилот' })
      .expect(201);

    const me = await http()
      .get('/v1/me')
      .set(...plain.authHeader)
      .expect(200);
    expect(me.body.workspaces[0]).toMatchObject({
      name: 'Мастерская Иванова',
      role: 'owner',
      timezone: 'Asia/Krasnoyarsk',
      hasActiveAccess: true,
    });
  });

  it('отклоняет неизвестный часовой пояс', async () => {
    await http()
      .post('/v1/admin/workspaces')
      .set(...admin.authHeader)
      .send({ name: 'Мастерская', ownerUserId: plain.id, timezone: 'Mars/Olympus' })
      .expect(422);
  });

  it('нельзя снять роль у последнего администратора и у себя', async () => {
    const self = await http()
      .delete(`/v1/admin/users/${admin.id}/platform-roles/admin`)
      .set(...admin.authHeader)
      .expect(409);
    expect(self.body.error.message).toMatch(/себя/);

    const second = await createUser(ctx, { platformRoles: ['admin'] });
    await http()
      .delete(`/v1/admin/users/${second.id}/platform-roles/admin`)
      .set(...admin.authHeader)
      .expect(204);
  });

  it('бан отзывает сессии пользователя', async () => {
    await http()
      .post(`/v1/admin/users/${plain.id}/ban`)
      .set(...admin.authHeader)
      .send({ reason: 'нарушение правил' })
      .expect(204);

    const res = await http()
      .get('/v1/me')
      .set(...plain.authHeader)
      .expect(401);
    expect(res.body.error.code).toBe('user_banned');
  });

  it('карточка пользователя показывает мастерские, но не их содержимое', async () => {
    const ws = await createWorkspace(ctx, { ownerUserId: plain.id, name: 'Кузовной цех' });
    const res = await http()
      .get(`/v1/admin/users/${plain.id}`)
      .set(...admin.authHeader)
      .expect(200);

    expect(res.body.workspaces).toEqual([
      expect.objectContaining({ id: ws.id, name: 'Кузовной цех', role: 'owner' }),
    ]);
    expect(res.body).not.toHaveProperty('clients');
    expect(res.body).not.toHaveProperty('orders');
  });
});

describe('ограничения базы данных', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  beforeEach(async () => {
    await truncateAll(ctx.prisma);
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('не допускает двух активных владельцев мастерской', async () => {
    const a = await createUser(ctx);
    const b = await createUser(ctx);
    const ws = await createWorkspace(ctx, { ownerUserId: a.id });

    await expect(
      ctx.prisma.workspaceMember.create({
        data: { workspaceId: ws.id, userId: b.id, role: 'owner' },
      }),
    ).rejects.toThrow();
  });

  it('не допускает доступ без субъекта', async () => {
    await expect(
      ctx.prisma.accessGrant.create({
        data: { product: 'club', subjectType: 'user', status: 'active' },
      }),
    ).rejects.toThrow();
  });

  it('не допускает срок окончания раньше начала', async () => {
    const user = await createUser(ctx);
    await expect(
      ctx.prisma.accessGrant.create({
        data: {
          product: 'club',
          subjectType: 'user',
          userId: user.id,
          validFrom: new Date(),
          validUntil: new Date(Date.now() - 86_400_000),
        },
      }),
    ).rejects.toThrow();
  });
});
