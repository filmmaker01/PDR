import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, truncateAll, type TestApp } from './helpers/app';
import { addEmployee, createUser, createWorkspace, type TestUser } from './helpers/factories';

describe('мастерские и доступы', () => {
  let ctx: TestApp;
  const http = () => request(ctx.app.getHttpServer());

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  beforeEach(async () => {
    await truncateAll(ctx.prisma);
  });
  afterAll(async () => {
    await ctx.close();
  });

  describe('изоляция мастерских', () => {
    it('участник мастерской A не видит мастерскую B даже по прямому ID', async () => {
      const ownerA = await createUser(ctx);
      const ownerB = await createUser(ctx);
      const wsA = await createWorkspace(ctx, { ownerUserId: ownerA.id, name: 'A' });
      const wsB = await createWorkspace(ctx, { ownerUserId: ownerB.id, name: 'B' });

      await http()
        .get(`/v1/workspaces/${wsA.id}`)
        .set(...ownerA.authHeader)
        .expect(200);

      const res = await http()
        .get(`/v1/workspaces/${wsB.id}`)
        .set(...ownerA.authHeader)
        .expect(404);
      expect(res.body.error.code).toBe('not_found');
    });

    it('администратор платформы не получает доступ к CRM мастерской', async () => {
      const owner = await createUser(ctx);
      const admin = await createUser(ctx, { platformRoles: ['admin'] });
      const ws = await createWorkspace(ctx, { ownerUserId: owner.id });

      await http()
        .get(`/v1/workspaces/${ws.id}`)
        .set(...admin.authHeader)
        .expect(404);
      await http()
        .get(`/v1/workspaces/${ws.id}/members`)
        .set(...admin.authHeader)
        .expect(404);
    });

    it('деактивированный сотрудник теряет доступ', async () => {
      const owner = await createUser(ctx);
      const employee = await createUser(ctx);
      const ws = await createWorkspace(ctx, { ownerUserId: owner.id });
      const memberId = await addEmployee(ctx, ws.id, employee.id);

      await http()
        .get(`/v1/workspaces/${ws.id}`)
        .set(...employee.authHeader)
        .expect(200);

      await ctx.prisma.workspaceMember.update({
        where: { id: memberId },
        data: { isActive: false },
      });
      await http()
        .get(`/v1/workspaces/${ws.id}`)
        .set(...employee.authHeader)
        .expect(404);
    });

    it('несуществующий и невалидный ID дают 404, а не 500', async () => {
      const user = await createUser(ctx);
      await http()
        .get('/v1/workspaces/00000000-0000-4000-8000-000000000000')
        .set(...user.authHeader)
        .expect(404);
      await http()
        .get('/v1/workspaces/not-a-uuid')
        .set(...user.authHeader)
        .expect(404);
    });
  });

  describe('права владельца и сотрудника', () => {
    let owner: TestUser;
    let employee: TestUser;
    let workspaceId: string;

    beforeEach(async () => {
      owner = await createUser(ctx);
      employee = await createUser(ctx);
      const ws = await createWorkspace(ctx, { ownerUserId: owner.id });
      workspaceId = ws.id;
      await addEmployee(ctx, workspaceId, employee.id);
    });

    it('владелец меняет настройки, сотрудник — нет', async () => {
      await http()
        .patch(`/v1/workspaces/${workspaceId}`)
        .set(...owner.authHeader)
        .send({ name: 'Новое имя' })
        .expect(200);

      await http()
        .patch(`/v1/workspaces/${workspaceId}`)
        .set(...employee.authHeader)
        .send({ name: 'Взлом' })
        .expect(404);
    });

    it('сотрудник видит список коллег', async () => {
      const res = await http()
        .get(`/v1/workspaces/${workspaceId}/members`)
        .set(...employee.authHeader)
        .expect(200);
      expect(res.body).toHaveLength(2);
    });

    it('приглашать может только владелец', async () => {
      await http()
        .post(`/v1/workspaces/${workspaceId}/invitations`)
        .set(...employee.authHeader)
        .send({})
        .expect(404);

      const res = await http()
        .post(`/v1/workspaces/${workspaceId}/invitations`)
        .set(...owner.authHeader)
        .send({ expiresInDays: 3 })
        .expect(201);
      expect(res.body.deepLink).toContain('startapp=inv_');
    });

    it('отклоняет неизвестные поля в настройках', async () => {
      await http()
        .patch(`/v1/workspaces/${workspaceId}`)
        .set(...owner.authHeader)
        .send({ settings: { employees_can_take_payments: false, secret_flag: true } })
        .expect(422);
    });

    it('настройка выключает право сотрудника', async () => {
      const before = await http()
        .get(`/v1/workspaces/${workspaceId}`)
        .set(...employee.authHeader)
        .expect(200);
      expect(before.body.permissions).toContain('payments.write_own');

      await http()
        .patch(`/v1/workspaces/${workspaceId}`)
        .set(...owner.authHeader)
        .send({ settings: { employees_can_take_payments: false } })
        .expect(200);

      const after = await http()
        .get(`/v1/workspaces/${workspaceId}`)
        .set(...employee.authHeader)
        .expect(200);
      expect(after.body.permissions).not.toContain('payments.write_own');
    });
  });

  describe('приглашения', () => {
    it('приглашение принимается один раз', async () => {
      const owner = await createUser(ctx);
      const invitee = await createUser(ctx);
      const other = await createUser(ctx);
      const ws = await createWorkspace(ctx, { ownerUserId: owner.id });

      const created = await http()
        .post(`/v1/workspaces/${ws.id}/invitations`)
        .set(...owner.authHeader)
        .send({})
        .expect(201);

      const token = new URL(created.body.deepLink).searchParams
        .get('startapp')!
        .replace('inv_', '');

      const accepted = await http()
        .post('/v1/invitations/accept')
        .set(...invitee.authHeader)
        .send({ token })
        .expect(201);
      expect(accepted.body.workspaceId).toBe(ws.id);

      const second = await http()
        .post('/v1/invitations/accept')
        .set(...other.authHeader)
        .send({ token })
        .expect(409);
      expect(second.body.error.code).toBe('conflict');
    });

    it('отозванное приглашение не принимается', async () => {
      const owner = await createUser(ctx);
      const invitee = await createUser(ctx);
      const ws = await createWorkspace(ctx, { ownerUserId: owner.id });

      const created = await http()
        .post(`/v1/workspaces/${ws.id}/invitations`)
        .set(...owner.authHeader)
        .send({})
        .expect(201);
      const token = new URL(created.body.deepLink).searchParams
        .get('startapp')!
        .replace('inv_', '');

      await http()
        .delete(`/v1/workspaces/${ws.id}/invitations/${created.body.id}`)
        .set(...owner.authHeader)
        .expect(204);

      await http()
        .post('/v1/invitations/accept')
        .set(...invitee.authHeader)
        .send({ token })
        .expect(404);
    });

    it('приглашение с номером телефона требует совпадения', async () => {
      const owner = await createUser(ctx);
      const invitee = await createUser(ctx);
      const ws = await createWorkspace(ctx, { ownerUserId: owner.id });

      const created = await http()
        .post(`/v1/workspaces/${ws.id}/invitations`)
        .set(...owner.authHeader)
        .send({ phone: '+7 999 111-22-33' })
        .expect(201);
      const token = new URL(created.body.deepLink).searchParams
        .get('startapp')!
        .replace('inv_', '');

      const noPhone = await http()
        .post('/v1/invitations/accept')
        .set(...invitee.authHeader)
        .send({ token })
        .expect(422);
      expect(noPhone.body.error.message).toMatch(/телефон/i);

      await ctx.prisma.user.update({
        where: { id: invitee.id },
        data: { phone: '+79995554433' },
      });
      await http()
        .post('/v1/invitations/accept')
        .set(...invitee.authHeader)
        .send({ token })
        .expect(403);

      await ctx.prisma.user.update({
        where: { id: invitee.id },
        data: { phone: '+79991112233' },
      });
      await http()
        .post('/v1/invitations/accept')
        .set(...invitee.authHeader)
        .send({ token })
        .expect(201);
    });
  });

  describe('передача владения', () => {
    it('владелец становится сотрудником, второго владельца не возникает', async () => {
      const owner = await createUser(ctx);
      const employee = await createUser(ctx);
      const ws = await createWorkspace(ctx, { ownerUserId: owner.id });
      const memberId = await addEmployee(ctx, ws.id, employee.id);

      await http()
        .post(`/v1/workspaces/${ws.id}/members/transfer-ownership`)
        .set(...owner.authHeader)
        .send({ memberId })
        .expect(204);

      const owners = await ctx.prisma.workspaceMember.findMany({
        where: { workspaceId: ws.id, role: 'owner', isActive: true },
      });
      expect(owners).toHaveLength(1);
      expect(owners[0]!.userId).toBe(employee.id);

      await http()
        .patch(`/v1/workspaces/${ws.id}`)
        .set(...owner.authHeader)
        .send({ name: 'Уже нельзя' })
        .expect(404);
    });

    it('владельца нельзя деактивировать', async () => {
      const owner = await createUser(ctx);
      const ws = await createWorkspace(ctx, { ownerUserId: owner.id });
      const res = await http()
        .patch(`/v1/workspaces/${ws.id}/members/${ws.ownerMemberId}`)
        .set(...owner.authHeader)
        .send({ isActive: false })
        .expect(409);
      expect(res.body.error.message).toMatch(/владельца/i);
    });
  });

  describe('доступ к CRM', () => {
    it('без доступа запись запрещена, чтение и выгрузка остаются', async () => {
      const owner = await createUser(ctx);
      const ws = await createWorkspace(ctx, { ownerUserId: owner.id, withAccess: false });

      const read = await http()
        .get(`/v1/workspaces/${ws.id}`)
        .set(...owner.authHeader)
        .expect(200);
      expect(read.body.access.active).toBe(false);

      const write = await http()
        .patch(`/v1/workspaces/${ws.id}`)
        .set(...owner.authHeader)
        .send({ name: 'Изменение' })
        .expect(403);
      expect(write.body.error.code).toBe('product_access_required');
    });

    it('истёкший доступ ведёт себя так же, как отсутствующий', async () => {
      const owner = await createUser(ctx);
      const ws = await createWorkspace(ctx, { ownerUserId: owner.id, withAccess: false });
      await ctx.prisma.accessGrant.create({
        data: {
          product: 'crm',
          subjectType: 'workspace',
          workspaceId: ws.id,
          status: 'active',
          validFrom: new Date(Date.now() - 10 * 86_400_000),
          validUntil: new Date(Date.now() - 86_400_000),
          grantedById: owner.id,
        },
      });

      await http()
        .patch(`/v1/workspaces/${ws.id}`)
        .set(...owner.authHeader)
        .send({ name: 'Изменение' })
        .expect(403);
    });

    it('отзыв доступа действует немедленно, без ожидания фоновой задачи', async () => {
      const owner = await createUser(ctx);
      const ws = await createWorkspace(ctx, { ownerUserId: owner.id });

      await http()
        .patch(`/v1/workspaces/${ws.id}`)
        .set(...owner.authHeader)
        .send({ name: 'До отзыва' })
        .expect(200);

      await ctx.prisma.accessGrant.update({
        where: { id: ws.grantId! },
        data: { status: 'revoked', revokedAt: new Date() },
      });

      await http()
        .patch(`/v1/workspaces/${ws.id}`)
        .set(...owner.authHeader)
        .send({ name: 'После отзыва' })
        .expect(403);
    });
  });

  describe('GET /me', () => {
    it('показывает мастерские и действующие продукты', async () => {
      const owner = await createUser(ctx);
      const ws = await createWorkspace(ctx, { ownerUserId: owner.id, name: 'Моя мастерская' });

      const res = await http()
        .get('/v1/me')
        .set(...owner.authHeader)
        .expect(200);
      expect(res.body.workspaces).toHaveLength(1);
      expect(res.body.workspaces[0]).toMatchObject({
        id: ws.id,
        name: 'Моя мастерская',
        role: 'owner',
        hasActiveAccess: true,
      });
      expect(res.body.products.map((p: { product: string }) => p.product)).toContain('crm');
    });

    it('не показывает мастерские, где пользователь деактивирован', async () => {
      const owner = await createUser(ctx);
      const employee = await createUser(ctx);
      const ws = await createWorkspace(ctx, { ownerUserId: owner.id });
      const memberId = await addEmployee(ctx, ws.id, employee.id);
      await ctx.prisma.workspaceMember.update({
        where: { id: memberId },
        data: { isActive: false },
      });

      const res = await http()
        .get('/v1/me')
        .set(...employee.authHeader)
        .expect(200);
      expect(res.body.workspaces).toHaveLength(0);
    });
  });
});
