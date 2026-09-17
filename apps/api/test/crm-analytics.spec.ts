import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, truncateAll, type TestApp } from './helpers/app';
import { addEmployee, createUser, createWorkspace, type TestUser } from './helpers/factories';

describe('CRM: сотрудники и аналитика', () => {
  let ctx: TestApp;
  let owner: TestUser;
  let employee: TestUser;
  let ownerMemberId: string;
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
    const ws = await createWorkspace(ctx, {
      ownerUserId: owner.id,
      name: 'Кузовной цех',
      settings: { employees_can_assign: true },
    });
    workspaceId = ws.id;
    ownerMemberId = ws.ownerMemberId;
    employeeMemberId = await addEmployee(ctx, workspaceId, employee.id);
  });

  afterAll(async () => {
    await ctx.close();
  });

  /** Заказ, доведённый до выдачи, со сметой и оплатой. */
  async function deliveredOrder(options: {
    totalMinor: number;
    paidMinor: number;
    assigneeMemberId?: string;
  }): Promise<string> {
    const order = await http()
      .post(`/v1/workspaces/${workspaceId}/orders`)
      .set(...owner.authHeader)
      .send({
        newClient: { name: `Клиент ${Math.random().toString(36).slice(2, 8)}` },
        title: 'Град',
        ...(options.assigneeMemberId ? { assigneeMemberId: options.assigneeMemberId } : {}),
      })
      .expect(201);

    const estimate = await http()
      .post(`/v1/workspaces/${workspaceId}/orders/${order.body.id}/estimates`)
      .set(...owner.authHeader)
      .send({})
      .expect(201);
    await http()
      .put(`/v1/workspaces/${workspaceId}/estimates/${estimate.body.id}/items`)
      .set(...owner.authHeader)
      .send({ items: [{ title: 'Работа', quantity: 1, unitPriceMinor: options.totalMinor }] })
      .expect(200);
    await http()
      .post(`/v1/workspaces/${workspaceId}/estimates/${estimate.body.id}/agree`)
      .set(...owner.authHeader)
      .expect(201);

    if (options.paidMinor > 0) {
      await http()
        .post(`/v1/workspaces/${workspaceId}/orders/${order.body.id}/payments`)
        .set(...owner.authHeader)
        .send({ amountMinor: options.paidMinor })
        .expect(201);
    }

    for (const to of ['in_progress', 'ready', 'delivered']) {
      await http()
        .post(`/v1/workspaces/${workspaceId}/orders/${order.body.id}/transition`)
        .set(...owner.authHeader)
        .send({ to })
        .expect(201);
    }
    return order.body.id;
  }

  describe('сводка', () => {
    it('считает завершённые заказы, поступления и средний чек', async () => {
      await deliveredOrder({ totalMinor: 1000000, paidMinor: 1000000 });
      await deliveredOrder({ totalMinor: 600000, paidMinor: 200000 });

      const res = await http()
        .get(`/v1/workspaces/${workspaceId}/analytics/summary`)
        .set(...owner.authHeader)
        .expect(200);

      expect(res.body.completedOrders).toBe(2);
      expect(res.body.completedTotalMinor).toBe(1600000);
      expect(res.body.receivedMinor).toBe(1200000);
      expect(res.body.averageCheckMinor).toBe(800000);
      expect(res.body.outstandingDebtMinor).toBeUndefined();
      expect(res.body.newClients).toBe(2);
      expect(res.body.currency).toBe('RUB');
    });

    it('возврат уменьшает поступления', async () => {
      const orderId = await deliveredOrder({ totalMinor: 500000, paidMinor: 500000 });
      await http()
        .post(`/v1/workspaces/${workspaceId}/orders/${orderId}/payments`)
        .set(...owner.authHeader)
        .send({ kind: 'refund', amountMinor: 200000 })
        .expect(201);

      const res = await http()
        .get(`/v1/workspaces/${workspaceId}/analytics/summary`)
        .set(...owner.authHeader)
        .expect(200);
      expect(res.body.receivedMinor).toBe(300000);
    });

    it('пустой период даёт нули, а не ошибку', async () => {
      const res = await http()
        .get(`/v1/workspaces/${workspaceId}/analytics/summary`)
        .query({ from: '2020-01-01', to: '2020-01-31' })
        .set(...owner.authHeader)
        .expect(200);

      expect(res.body.completedOrders).toBe(0);
      expect(res.body.averageCheckMinor).toBe(0);
      expect(res.body.receivedMinor).toBe(0);
    });

    it('отклоняет перевёрнутый и слишком длинный период', async () => {
      await http()
        .get(`/v1/workspaces/${workspaceId}/analytics/summary`)
        .query({ from: '2026-05-01', to: '2026-04-01' })
        .set(...owner.authHeader)
        .expect(422);

      await http()
        .get(`/v1/workspaces/${workspaceId}/analytics/summary`)
        .query({ from: '2020-01-01', to: '2026-01-01' })
        .set(...owner.authHeader)
        .expect(422);
    });

    it('аналитика закрыта для сотрудника', async () => {
      await http()
        .get(`/v1/workspaces/${workspaceId}/analytics/summary`)
        .set(...employee.authHeader)
        .expect(404);
    });

    it('не показывает данные чужой мастерской', async () => {
      const otherOwner = await createUser(ctx, { firstName: 'Чужой' });
      const other = await createWorkspace(ctx, { ownerUserId: otherOwner.id, name: 'Чужая' });
      await deliveredOrder({ totalMinor: 900000, paidMinor: 900000 });

      const res = await http()
        .get(`/v1/workspaces/${other.id}/analytics/summary`)
        .set(...otherOwner.authHeader)
        .expect(200);
      expect(res.body.completedOrders).toBe(0);
      expect(res.body.receivedMinor).toBe(0);
    });
  });

  describe('ряды и исполнители', () => {
    it('отдаёт ряд по дням', async () => {
      await deliveredOrder({ totalMinor: 300000, paidMinor: 300000 });

      const res = await http()
        .get(`/v1/workspaces/${workspaceId}/analytics/series`)
        .set(...owner.authHeader)
        .expect(200);

      expect(res.body.granularity).toBe('day');
      expect(res.body.points.length).toBeGreaterThan(0);
      const totals = res.body.points.reduce(
        (sum: number, point: { receivedMinor: number }) => sum + point.receivedMinor,
        0,
      );
      expect(totals).toBe(300000);
    });

    it('разбивает показатели по исполнителям', async () => {
      await deliveredOrder({
        totalMinor: 1000000,
        paidMinor: 1000000,
        assigneeMemberId: ownerMemberId,
      });
      await deliveredOrder({
        totalMinor: 400000,
        paidMinor: 400000,
        assigneeMemberId: employeeMemberId,
      });

      const res = await http()
        .get(`/v1/workspaces/${workspaceId}/analytics/employees`)
        .set(...owner.authHeader)
        .expect(200);

      expect(res.body.rows).toHaveLength(2);
      expect(res.body.rows[0].completedTotalMinor).toBe(1000000);
      expect(res.body.rows[0].name).toContain('Владелец');
      expect(res.body.rows[1].receivedMinor).toBe(400000);
    });

    it('фильтрует сводку по исполнителю', async () => {
      await deliveredOrder({
        totalMinor: 1000000,
        paidMinor: 1000000,
        assigneeMemberId: ownerMemberId,
      });
      await deliveredOrder({
        totalMinor: 400000,
        paidMinor: 400000,
        assigneeMemberId: employeeMemberId,
      });

      const res = await http()
        .get(`/v1/workspaces/${workspaceId}/analytics/summary`)
        .query({ assigneeMemberId: employeeMemberId })
        .set(...owner.authHeader)
        .expect(200);

      expect(res.body.completedOrders).toBe(1);
      expect(res.body.completedTotalMinor).toBe(400000);
      expect(res.body.receivedMinor).toBe(400000);
    });

    it('учитывает загрузку календаря', async () => {
      const day = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
      const appointment = await http()
        .post(`/v1/workspaces/${workspaceId}/appointments`)
        .set(...owner.authHeader)
        .send({ startsAtLocal: `${day}T10:00`, durationMin: 120 })
        .expect(201);
      await http()
        .post(`/v1/workspaces/${workspaceId}/appointments/${appointment.body.id}/status`)
        .set(...owner.authHeader)
        .send({ to: 'confirmed' })
        .expect(201);

      const res = await http()
        .get(`/v1/workspaces/${workspaceId}/analytics/summary`)
        .query({ to: day })
        .set(...owner.authHeader)
        .expect(200);

      expect(res.body.appointmentMinutes).toBe(120);
    });
  });

  describe('сотрудники', () => {
    it('владелец меняет имя и цвет сотрудника', async () => {
      const res = await http()
        .patch(`/v1/workspaces/${workspaceId}/members/${employeeMemberId}`)
        .set(...owner.authHeader)
        .send({ displayName: 'Пётр', color: '#ff8800' })
        .expect(200);
      expect(res.body.id).toBe(employeeMemberId);

      const members = await http()
        .get(`/v1/workspaces/${workspaceId}/members`)
        .set(...owner.authHeader)
        .expect(200);
      const updated = members.body.find((m: { id: string }) => m.id === employeeMemberId);
      expect(updated.name).toBe('Пётр');
      expect(updated.color).toBe('#ff8800');
    });

    it('деактивированный сотрудник теряет доступ к мастерской', async () => {
      await http()
        .patch(`/v1/workspaces/${workspaceId}/members/${employeeMemberId}`)
        .set(...owner.authHeader)
        .send({ isActive: false })
        .expect(200);

      await http()
        .get(`/v1/workspaces/${workspaceId}/orders`)
        .set(...employee.authHeader)
        .expect(404);
    });

    it('сотрудник не может менять других сотрудников', async () => {
      await http()
        .patch(`/v1/workspaces/${workspaceId}/members/${ownerMemberId}`)
        .set(...employee.authHeader)
        .send({ displayName: 'Я главный' })
        .expect(404);
    });

    it('передача владения меняет роли местами', async () => {
      await http()
        .post(`/v1/workspaces/${workspaceId}/members/transfer-ownership`)
        .set(...owner.authHeader)
        .send({ memberId: employeeMemberId })
        .expect(204);

      const members = await http()
        .get(`/v1/workspaces/${workspaceId}/members`)
        .set(...employee.authHeader)
        .expect(200);
      const newOwner = members.body.find((m: { id: string }) => m.id === employeeMemberId);
      const oldOwner = members.body.find((m: { id: string }) => m.id === ownerMemberId);
      expect(newOwner.role).toBe('owner');
      expect(oldOwner.role).toBe('employee');

      // Аналитика теперь доступна новому владельцу и закрыта для прежнего.
      await http()
        .get(`/v1/workspaces/${workspaceId}/analytics/summary`)
        .set(...employee.authHeader)
        .expect(200);
      await http()
        .get(`/v1/workspaces/${workspaceId}/analytics/summary`)
        .set(...owner.authHeader)
        .expect(404);
    });
  });

  describe('журнал действий мастерской', () => {
    it('показывает действия владельцу', async () => {
      await deliveredOrder({ totalMinor: 100000, paidMinor: 0 });

      const res = await http()
        .get(`/v1/workspaces/${workspaceId}/audit`)
        .set(...owner.authHeader)
        .expect(200);

      expect(res.body.items.length).toBeGreaterThan(0);
      expect(res.body.items.some((row: { entityType: string }) => row.entityType === 'order')).toBe(
        true,
      );
    });

    it('журнал закрыт для сотрудника', async () => {
      await http()
        .get(`/v1/workspaces/${workspaceId}/audit`)
        .set(...employee.authHeader)
        .expect(404);
    });
  });
});
