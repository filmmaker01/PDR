import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, truncateAll, type TestApp } from './helpers/app';
import { addEmployee, createUser, createWorkspace, type TestUser } from './helpers/factories';

/**
 * Сводный прогон обязательных проверок безопасности из docs/11-testing-quality.md.
 * Отдельные механизмы проверены в своих файлах; здесь — правила, общие
 * для всего API, чтобы новый маршрут не проехал мимо них незамеченным.
 */
describe('безопасность: общие правила API', () => {
  let ctx: TestApp;
  let owner: TestUser;
  let employee: TestUser;
  let admin: TestUser;
  let stranger: TestUser;
  let workspaceId: string;
  let foreignWorkspaceId: string;
  let orderId: string;
  const http = () => request(ctx.app.getHttpServer());

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    owner = await createUser(ctx, { firstName: 'Владелец' });
    employee = await createUser(ctx, { firstName: 'Сотрудник' });
    admin = await createUser(ctx, { firstName: 'Админ' });
    stranger = await createUser(ctx, { firstName: 'Посторонний' });
    await ctx.prisma.platformRole.create({ data: { userId: admin.id, role: 'admin' } });

    const ws = await createWorkspace(ctx, { ownerUserId: owner.id, name: 'Наша' });
    workspaceId = ws.id;
    await addEmployee(ctx, workspaceId, employee.id);

    const other = await createWorkspace(ctx, { ownerUserId: stranger.id, name: 'Чужая' });
    foreignWorkspaceId = other.id;

    const order = await http()
      .post(`/v1/workspaces/${workspaceId}/orders`)
      .set(...owner.authHeader)
      .send({ newClient: { name: 'Клиент' }, title: 'Работа' })
      .expect(201);
    orderId = order.body.id;
  });

  afterAll(async () => {
    await ctx.close();
  });

  describe('маршруты закрыты по умолчанию', () => {
    const closedRoutes = [
      ['get', '/v1/me'],
      ['get', '/v1/club/status'],
      ['get', '/v1/admin/dashboard'],
      ['get', '/v1/admin/users'],
    ] as const;

    it.each(closedRoutes)('%s %s без сессии отвечает 401', async (method, path) => {
      await http()[method](path).expect(401);
    });

    it('битый токен не пускает', async () => {
      await http().get('/v1/me').set('Authorization', 'Bearer not-a-token').expect(401);
    });
  });

  describe('изоляция мастерских', () => {
    it('участник одной мастерской не видит другую', async () => {
      await http()
        .get(`/v1/workspaces/${foreignWorkspaceId}/orders`)
        .set(...owner.authHeader)
        .expect(404);
    });

    it('администратор платформы без членства тоже не видит мастерскую', async () => {
      await http()
        .get(`/v1/workspaces/${workspaceId}/orders`)
        .set(...admin.authHeader)
        .expect(404);

      await http()
        .get(`/v1/workspaces/${workspaceId}/clients`)
        .set(...admin.authHeader)
        .expect(404);
    });

    it('объект чужой мастерской по прямому идентификатору недоступен', async () => {
      await http()
        .get(`/v1/workspaces/${foreignWorkspaceId}/orders/${orderId}`)
        .set(...stranger.authHeader)
        .expect(404);
    });

    it('деактивированный участник теряет доступ немедленно', async () => {
      const member = await ctx.prisma.workspaceMember.findFirstOrThrow({
        where: { workspaceId, userId: employee.id },
      });
      await ctx.prisma.workspaceMember.update({
        where: { id: member.id },
        data: { isActive: false },
      });

      await http()
        .get(`/v1/workspaces/${workspaceId}/orders`)
        .set(...employee.authHeader)
        .expect(404);
    });
  });

  describe('истёкший доступ к CRM', () => {
    beforeEach(async () => {
      await ctx.prisma.accessGrant.updateMany({
        where: { workspaceId, product: 'crm' },
        data: { status: 'expired', validUntil: new Date(Date.now() - 86_400_000) },
      });
    });

    it('чтение остаётся доступным', async () => {
      await http()
        .get(`/v1/workspaces/${workspaceId}/orders`)
        .set(...owner.authHeader)
        .expect(200);
    });

    it('запись блокируется', async () => {
      const res = await http()
        .post(`/v1/workspaces/${workspaceId}/orders`)
        .set(...owner.authHeader)
        .send({ newClient: { name: 'Ещё клиент' } })
        .expect(403);
      expect(res.body.error.code).toBe('product_access_required');
    });
  });

  describe('строгие схемы и массовое присваивание', () => {
    it('неизвестное поле в теле отвергается', async () => {
      await http()
        .post(`/v1/workspaces/${workspaceId}/clients`)
        .set(...owner.authHeader)
        .send({ name: 'Иван', isAdmin: true })
        .expect(422);
    });

    it('служебные поля из тела игнорируются', async () => {
      const res = await http()
        .post(`/v1/workspaces/${workspaceId}/orders`)
        .set(...owner.authHeader)
        .send({ newClient: { name: 'Клиент' }, title: 'Работа' })
        .expect(201);

      const order = await ctx.prisma.order.findUniqueOrThrow({ where: { id: res.body.id } });
      expect(order.workspaceId).toBe(workspaceId);
      expect(Number(order.paidMinor)).toBe(0);
      expect(order.createdById).toBe(owner.id);
    });

    it('подменить мастерскую в теле нельзя', async () => {
      await http()
        .post(`/v1/workspaces/${workspaceId}/clients`)
        .set(...owner.authHeader)
        .send({ name: 'Иван', workspaceId: foreignWorkspaceId })
        .expect(422);
    });
  });

  describe('идемпотентность', () => {
    it('тот же ключ с другим телом отвергается', async () => {
      const key = '22222222-3333-4444-5555-666666666666';
      await http()
        .post(`/v1/workspaces/${workspaceId}/orders`)
        .set(...owner.authHeader)
        .set('Idempotency-Key', key)
        .send({ newClient: { name: 'Первый' } })
        .expect(201);

      const res = await http()
        .post(`/v1/workspaces/${workspaceId}/orders`)
        .set(...owner.authHeader)
        .set('Idempotency-Key', key)
        .send({ newClient: { name: 'Второй' } })
        .expect(422);
      expect(res.body.error.code).toBe('idempotency_mismatch');
    });
  });

  describe('оплаты неизменяемы', () => {
    it('маршрутов изменения и удаления записи оплаты нет', async () => {
      const payment = await http()
        .post(`/v1/workspaces/${workspaceId}/orders/${orderId}/payments`)
        .set(...owner.authHeader)
        .send({ amountMinor: 100000 })
        .expect(201);

      await http()
        .patch(`/v1/workspaces/${workspaceId}/orders/${orderId}/payments/${payment.body.id}`)
        .set(...owner.authHeader)
        .send({ amountMinor: 1 })
        .expect(404);

      await http()
        .delete(`/v1/workspaces/${workspaceId}/orders/${orderId}/payments/${payment.body.id}`)
        .set(...owner.authHeader)
        .expect(404);

      expect(await ctx.prisma.paymentEntry.count({ where: { workspaceId } })).toBe(1);
    });
  });

  describe('сессии', () => {
    it('отозванная сессия перестаёт работать', async () => {
      await http()
        .post('/v1/auth/logout-all')
        .set(...owner.authHeader)
        .expect(200);

      await http()
        .get('/v1/me')
        .set(...owner.authHeader)
        .expect(401);
    });

    it('забаненный пользователь теряет доступ', async () => {
      await ctx.prisma.user.update({ where: { id: employee.id }, data: { isBanned: true } });

      const res = await http()
        .get('/v1/me')
        .set(...employee.authHeader)
        .expect(401);
      expect(res.body.error.code).toBe('user_banned');
    });
  });

  describe('webhook Telegram', () => {
    it('неверный секрет в пути отклоняется', async () => {
      await http()
        .post('/v1/telegram/webhook/wrong-secret')
        .set('X-Telegram-Bot-Api-Secret-Token', 'test-webhook-secret')
        .send({ update_id: 1 })
        .expect(403);
    });

    it('неверный заголовок отклоняется', async () => {
      await http()
        .post('/v1/telegram/webhook/test-webhook-secret')
        .set('X-Telegram-Bot-Api-Secret-Token', 'wrong')
        .send({ update_id: 2 })
        .expect(403);
    });
  });

  describe('файлы', () => {
    it('presign на чужую мастерскую отклоняется', async () => {
      await http()
        .post('/v1/files/presign-upload')
        .set(...owner.authHeader)
        .send({
          scope: 'order_photo',
          mimeType: 'image/jpeg',
          sizeBytes: 1024,
          workspaceId: foreignWorkspaceId,
        })
        .expect(404);
    });

    it('неподдерживаемый тип отклоняется', async () => {
      const res = await http()
        .post('/v1/files/presign-upload')
        .set(...owner.authHeader)
        .send({
          scope: 'order_photo',
          mimeType: 'application/x-msdownload',
          sizeBytes: 1024,
          workspaceId,
        })
        .expect(422);
      expect(res.body.error.code).toBe('unsupported_file_type');
    });
  });
});
