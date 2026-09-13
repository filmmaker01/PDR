import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, truncateAll, type TestApp } from './helpers/app';
import { addEmployee, createUser, createWorkspace, type TestUser } from './helpers/factories';

describe('CRM: клиенты, автомобили, заказы', () => {
  let ctx: TestApp;
  let owner: TestUser;
  let employee: TestUser;
  let employeeMemberId: string;
  let workspaceId: string;
  const http = () => request(ctx.app.getHttpServer());

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    owner = await createUser(ctx, { firstName: 'Владелец' });
    employee = await createUser(ctx, { firstName: 'Сотрудник' });
    const ws = await createWorkspace(ctx, { ownerUserId: owner.id, name: 'Кузовной цех' });
    workspaceId = ws.id;
    employeeMemberId = await addEmployee(ctx, workspaceId, employee.id);
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function createOrder(
    user: TestUser = owner,
    body: Record<string, unknown> = {},
  ): Promise<{ id: string; number: number }> {
    const res = await http()
      .post(`/v1/workspaces/${workspaceId}/orders`)
      .set(...user.authHeader)
      .send({
        newClient: { name: 'Иван Петров', phone: '8 999 123-45-67' },
        newVehicle: { make: 'Toyota', model: 'Camry', plate: 'a123bc77' },
        title: 'Град на капоте',
        ...body,
      })
      .expect(201);
    return res.body;
  }

  describe('клиенты и автомобили', () => {
    it('создаёт клиента с нормализованным телефоном', async () => {
      const res = await http()
        .post(`/v1/workspaces/${workspaceId}/clients`)
        .set(...owner.authHeader)
        .send({ name: 'Иван', phone: '8 (999) 123-45-67' })
        .expect(201);
      expect(res.body.phone).toBe('+79991234567');
    });

    it('отклоняет непохожий на номер телефон', async () => {
      await http()
        .post(`/v1/workspaces/${workspaceId}/clients`)
        .set(...owner.authHeader)
        .send({ name: 'Иван', phone: 'нет' })
        .expect(422);
    });

    it('нормализует госномер и проверяет VIN', async () => {
      const client = await http()
        .post(`/v1/workspaces/${workspaceId}/clients`)
        .set(...owner.authHeader)
        .send({ name: 'Иван' })
        .expect(201);

      const vehicle = await http()
        .post(`/v1/workspaces/${workspaceId}/clients/${client.body.id}/vehicles`)
        .set(...owner.authHeader)
        .send({ make: 'Toyota', model: 'Camry', plate: 'a123bc 77', vin: 'WVWZZZ1JZXW000001' })
        .expect(201);
      expect(vehicle.body.plate).toBe('А123ВС77');

      await http()
        .post(`/v1/workspaces/${workspaceId}/clients/${client.body.id}/vehicles`)
        .set(...owner.authHeader)
        .send({ make: 'Toyota', model: 'Camry', vin: 'КОРОТКИЙ' })
        .expect(422);
    });

    it('ищет клиента по телефону и по номеру автомобиля', async () => {
      await createOrder();

      const byPhone = await http()
        .get(`/v1/workspaces/${workspaceId}/clients?q=9991234567`)
        .set(...owner.authHeader)
        .expect(200);
      expect(byPhone.body.items).toHaveLength(1);

      const byPlate = await http()
        .get(`/v1/workspaces/${workspaceId}/clients?q=А123ВС77`)
        .set(...owner.authHeader)
        .expect(200);
      expect(byPlate.body.items).toHaveLength(1);
    });

    it('карточка клиента показывает автомобили и историю обращений', async () => {
      const order = await createOrder();
      const orderCard = await http()
        .get(`/v1/workspaces/${workspaceId}/orders/${order.id}`)
        .set(...owner.authHeader)
        .expect(200);

      const card = await http()
        .get(`/v1/workspaces/${workspaceId}/clients/${orderCard.body.client.id}`)
        .set(...owner.authHeader)
        .expect(200);

      expect(card.body.vehicles).toHaveLength(1);
      expect(card.body.orders).toHaveLength(1);
      expect(card.body.orders[0].number).toBe(order.number);
    });

    it('архивированные клиенты не попадают в основной список', async () => {
      const client = await http()
        .post(`/v1/workspaces/${workspaceId}/clients`)
        .set(...owner.authHeader)
        .send({ name: 'Архивный' })
        .expect(201);

      await http()
        .post(`/v1/workspaces/${workspaceId}/clients/${client.body.id}/archive`)
        .set(...owner.authHeader)
        .send({ archived: true })
        .expect(201);

      const active = await http()
        .get(`/v1/workspaces/${workspaceId}/clients`)
        .set(...owner.authHeader)
        .expect(200);
      expect(active.body.items).toHaveLength(0);

      const archived = await http()
        .get(`/v1/workspaces/${workspaceId}/clients?archived=true`)
        .set(...owner.authHeader)
        .expect(200);
      expect(archived.body.items).toHaveLength(1);
    });

    it('сотрудник не может архивировать клиента', async () => {
      const client = await http()
        .post(`/v1/workspaces/${workspaceId}/clients`)
        .set(...employee.authHeader)
        .send({ name: 'Клиент сотрудника' })
        .expect(201);

      await http()
        .post(`/v1/workspaces/${workspaceId}/clients/${client.body.id}/archive`)
        .set(...employee.authHeader)
        .send({ archived: true })
        .expect(404);
    });
  });

  describe('создание заказа', () => {
    it('создаёт клиента, автомобиль и заказ одной операцией', async () => {
      const order = await createOrder();
      expect(order.number).toBe(1);

      const card = await http()
        .get(`/v1/workspaces/${workspaceId}/orders/${order.id}`)
        .set(...owner.authHeader)
        .expect(200);

      expect(card.body.client.name).toBe('Иван Петров');
      expect(card.body.client.phone).toBe('+79991234567');
      expect(card.body.vehicle.plate).toBe('А123ВС77');
      expect(card.body.status).toBe('new');
      expect(card.body.history).toHaveLength(1);
    });

    it('нумерует заказы последовательно внутри мастерской', async () => {
      const first = await createOrder();
      const second = await createOrder();
      expect(second.number).toBe(first.number + 1);

      // В другой мастерской нумерация своя.
      const otherOwner = await createUser(ctx);
      const other = await createWorkspace(ctx, { ownerUserId: otherOwner.id });
      const res = await http()
        .post(`/v1/workspaces/${other.id}/orders`)
        .set(...otherOwner.authHeader)
        .send({ newClient: { name: 'Пётр' }, title: 'Вмятина' })
        .expect(201);
      expect(res.body.number).toBe(1);
    });

    it('повторный запрос с тем же ключом не создаёт дубль', async () => {
      const key = '22222222-3333-4444-8555-666666666666';
      const first = await http()
        .post(`/v1/workspaces/${workspaceId}/orders`)
        .set(...owner.authHeader)
        .set('Idempotency-Key', key)
        .send({ newClient: { name: 'Иван' }, title: 'Заказ' })
        .expect(201);
      const second = await http()
        .post(`/v1/workspaces/${workspaceId}/orders`)
        .set(...owner.authHeader)
        .set('Idempotency-Key', key)
        .send({ newClient: { name: 'Иван' }, title: 'Заказ' })
        .expect(201);

      expect(second.body.id).toBe(first.body.id);
      expect(await ctx.prisma.order.count()).toBe(1);
    });

    it('ошибка в данных откатывает всю транзакцию', async () => {
      await http()
        .post(`/v1/workspaces/${workspaceId}/orders`)
        .set(...owner.authHeader)
        .send({
          newClient: { name: 'Иван', phone: 'не телефон' },
          newVehicle: { make: 'Toyota', model: 'Camry' },
        })
        .expect(422);

      expect(await ctx.prisma.client.count()).toBe(0);
      expect(await ctx.prisma.vehicle.count()).toBe(0);
      expect(await ctx.prisma.order.count()).toBe(0);
    });

    it('нельзя привязать автомобиль другого клиента', async () => {
      const first = await createOrder();
      const firstCard = await http()
        .get(`/v1/workspaces/${workspaceId}/orders/${first.id}`)
        .set(...owner.authHeader)
        .expect(200);

      const otherClient = await http()
        .post(`/v1/workspaces/${workspaceId}/clients`)
        .set(...owner.authHeader)
        .send({ name: 'Другой клиент' })
        .expect(201);

      await http()
        .post(`/v1/workspaces/${workspaceId}/orders`)
        .set(...owner.authHeader)
        .send({ clientId: otherClient.body.id, vehicleId: firstCard.body.vehicle.id })
        .expect(422);
    });

    it('по умолчанию исполнитель — создавший заказ', async () => {
      const order = await createOrder(employee);
      const card = await http()
        .get(`/v1/workspaces/${workspaceId}/orders/${order.id}`)
        .set(...employee.authHeader)
        .expect(200);
      expect(card.body.assignee.id).toBe(employeeMemberId);
    });

    it('сотрудник не может назначить заказ другому', async () => {
      const res = await http()
        .post(`/v1/workspaces/${workspaceId}/orders`)
        .set(...employee.authHeader)
        .send({ newClient: { name: 'Иван' }, assigneeMemberId: await ownerMemberId() })
        .expect(403);
      expect(res.body.error.message).toMatch(/владелец/i);
    });
  });

  describe('статусы заказа', () => {
    it('проходит полный путь от нового до выданного', async () => {
      const order = await createOrder();
      const path = ['pending_approval', 'scheduled', 'in_progress', 'ready', 'delivered'];

      for (const to of path) {
        const res = await http()
          .post(`/v1/workspaces/${workspaceId}/orders/${order.id}/transition`)
          .set(...owner.authHeader)
          .send({ to })
          .expect(201);
        expect(res.body.status).toBe(to);
      }

      const card = await http()
        .get(`/v1/workspaces/${workspaceId}/orders/${order.id}`)
        .set(...owner.authHeader)
        .expect(200);
      expect(card.body.deliveredAt).not.toBeNull();
      expect(card.body.startedAt).not.toBeNull();
      expect(card.body.history).toHaveLength(6);
    });

    it('запрещённый переход отклоняется с перечнем допустимых', async () => {
      const order = await createOrder();
      const res = await http()
        .post(`/v1/workspaces/${workspaceId}/orders/${order.id}/transition`)
        .set(...owner.authHeader)
        .send({ to: 'delivered' })
        .expect(409);

      expect(res.body.error.code).toBe('invalid_transition');
      expect(res.body.error.details.allowed).toContain('pending_approval');
      expect(res.body.error.details.allowed).not.toContain('delivered');
    });

    it('отмена требует причины и отражается в истории', async () => {
      const order = await createOrder();
      await http()
        .post(`/v1/workspaces/${workspaceId}/orders/${order.id}/transition`)
        .set(...owner.authHeader)
        .send({ to: 'cancelled' })
        .expect(422);

      await http()
        .post(`/v1/workspaces/${workspaceId}/orders/${order.id}/transition`)
        .set(...owner.authHeader)
        .send({ to: 'cancelled', comment: 'клиент отказался' })
        .expect(201);

      const card = await http()
        .get(`/v1/workspaces/${workspaceId}/orders/${order.id}`)
        .set(...owner.authHeader)
        .expect(200);
      expect(card.body.cancelReason).toBe('клиент отказался');
    });

    it('вернуть выданный заказ может только владелец', async () => {
      const order = await createOrder(employee);
      for (const to of ['in_progress', 'ready', 'delivered']) {
        await http()
          .post(`/v1/workspaces/${workspaceId}/orders/${order.id}/transition`)
          .set(...employee.authHeader)
          .send({ to })
          .expect(201);
      }

      const denied = await http()
        .post(`/v1/workspaces/${workspaceId}/orders/${order.id}/transition`)
        .set(...employee.authHeader)
        .send({ to: 'ready', comment: 'вернуть' })
        .expect(403);
      expect(denied.body.error.message).toMatch(/владельцу/i);

      await http()
        .post(`/v1/workspaces/${workspaceId}/orders/${order.id}/transition`)
        .set(...owner.authHeader)
        .send({ to: 'ready', comment: 'клиент вернулся с замечанием' })
        .expect(201);
    });
  });

  describe('права сотрудника', () => {
    it('сотрудник не может менять чужой заказ', async () => {
      const ownerOrder = await createOrder(owner);

      await http()
        .patch(`/v1/workspaces/${workspaceId}/orders/${ownerOrder.id}`)
        .set(...employee.authHeader)
        .send({ title: 'Правка чужого' })
        .expect(404);

      await http()
        .post(`/v1/workspaces/${workspaceId}/orders/${ownerOrder.id}/transition`)
        .set(...employee.authHeader)
        .send({ to: 'in_progress' })
        .expect(404);
    });

    it('настройка скрывает чужие заказы из списка', async () => {
      await createOrder(owner);
      await createOrder(employee);

      const seesAll = await http()
        .get(`/v1/workspaces/${workspaceId}/orders`)
        .set(...employee.authHeader)
        .expect(200);
      expect(seesAll.body.items).toHaveLength(2);

      await http()
        .patch(`/v1/workspaces/${workspaceId}`)
        .set(...owner.authHeader)
        .send({ settings: { employees_see_all_orders: false } })
        .expect(200);

      const seesOwn = await http()
        .get(`/v1/workspaces/${workspaceId}/orders`)
        .set(...employee.authHeader)
        .expect(200);
      expect(seesOwn.body.items).toHaveLength(1);
    });

    it('владелец может переназначить заказ, сотрудник получает уведомление', async () => {
      const order = await createOrder(owner);
      await http()
        .patch(`/v1/workspaces/${workspaceId}/orders/${order.id}`)
        .set(...owner.authHeader)
        .send({ assigneeMemberId: employeeMemberId })
        .expect(200);

      const notification = await ctx.prisma.notification.findFirst({
        where: { userId: employee.id, type: 'order_assigned' },
      });
      expect(notification).not.toBeNull();
    });

    it('архивировать заказ может только владелец', async () => {
      const order = await createOrder(employee);
      await http()
        .post(`/v1/workspaces/${workspaceId}/orders/${order.id}/archive`)
        .set(...employee.authHeader)
        .send({ archived: true })
        .expect(404);

      await http()
        .post(`/v1/workspaces/${workspaceId}/orders/${order.id}/archive`)
        .set(...owner.authHeader)
        .send({ archived: true })
        .expect(201);
    });
  });

  describe('изоляция мастерских', () => {
    it('заказ другой мастерской недоступен по прямому ID', async () => {
      const order = await createOrder();
      const otherOwner = await createUser(ctx);
      const other = await createWorkspace(ctx, { ownerUserId: otherOwner.id });

      // Тот же идентификатор заказа, но в чужой мастерской.
      await http()
        .get(`/v1/workspaces/${other.id}/orders/${order.id}`)
        .set(...otherOwner.authHeader)
        .expect(404);

      // И своя мастерская в пути, но чужая сессия.
      await http()
        .get(`/v1/workspaces/${workspaceId}/orders/${order.id}`)
        .set(...otherOwner.authHeader)
        .expect(404);
    });

    it('клиент другой мастерской не находится поиском', async () => {
      await createOrder();
      const otherOwner = await createUser(ctx);
      const other = await createWorkspace(ctx, { ownerUserId: otherOwner.id });

      const res = await http()
        .get(`/v1/workspaces/${other.id}/clients?q=Иван`)
        .set(...otherOwner.authHeader)
        .expect(200);
      expect(res.body.items).toHaveLength(0);
    });

    it('администратор платформы не видит заказы мастерской', async () => {
      const order = await createOrder();
      const admin = await createUser(ctx, { platformRoles: ['admin'] });

      await http()
        .get(`/v1/workspaces/${workspaceId}/orders`)
        .set(...admin.authHeader)
        .expect(404);
      await http()
        .get(`/v1/workspaces/${workspaceId}/orders/${order.id}`)
        .set(...admin.authHeader)
        .expect(404);
    });

    it('без доступа к CRM чтение работает, запись — нет', async () => {
      const order = await createOrder();
      await ctx.prisma.accessGrant.updateMany({
        where: { workspaceId, product: 'crm' },
        data: { status: 'revoked', revokedAt: new Date() },
      });

      await http()
        .get(`/v1/workspaces/${workspaceId}/orders/${order.id}`)
        .set(...owner.authHeader)
        .expect(200);

      const write = await http()
        .patch(`/v1/workspaces/${workspaceId}/orders/${order.id}`)
        .set(...owner.authHeader)
        .send({ title: 'Изменение' })
        .expect(403);
      expect(write.body.error.code).toBe('product_access_required');
    });

    it('база не даёт связать заказ с автомобилем чужой мастерской', async () => {
      const order = await createOrder();
      const otherOwner = await createUser(ctx);
      const other = await createWorkspace(ctx, { ownerUserId: otherOwner.id });
      const foreignClient = await ctx.prisma.client.create({
        data: { workspaceId: other.id, name: 'Чужой' },
      });
      const foreignVehicle = await ctx.prisma.vehicle.create({
        data: {
          workspaceId: other.id,
          clientId: foreignClient.id,
          make: 'BMW',
          model: 'X5',
        },
      });

      // Составной внешний ключ не позволит записать чужой автомобиль.
      await expect(
        ctx.prisma.order.update({
          where: { id: order.id },
          data: { vehicleId: foreignVehicle.id },
        }),
      ).rejects.toThrow();
    });
  });

  async function ownerMemberId(): Promise<string> {
    const member = await ctx.prisma.workspaceMember.findFirst({
      where: { workspaceId, role: 'owner' },
    });
    return member!.id;
  }
});
