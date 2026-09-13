import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, truncateAll, type TestApp } from './helpers/app';
import { addEmployee, createUser, createWorkspace, type TestUser } from './helpers/factories';

/** Ближайший понедельник: тесты не должны зависеть от текущего дня недели. */
function futureDay(offsetDays = 3): string {
  const date = new Date(Date.now() + offsetDays * 86_400_000);
  return date.toISOString().slice(0, 10);
}

describe('CRM: календарь и записи', () => {
  let ctx: TestApp;
  let owner: TestUser;
  let employee: TestUser;
  let ownerMemberId: string;
  let employeeMemberId: string;
  let workspaceId: string;
  const day = futureDay();
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
    ownerMemberId = ws.ownerMemberId;
    employeeMemberId = await addEmployee(ctx, workspaceId, employee.id);
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function createAppointment(
    user: TestUser = owner,
    body: Record<string, unknown> = {},
  ): Promise<Record<string, never>> {
    const res = await http()
      .post(`/v1/workspaces/${workspaceId}/appointments`)
      .set(...user.authHeader)
      .send({ startsAtLocal: `${day}T10:00`, durationMin: 60, kind: 'repair', ...body })
      .expect(201);
    return res.body;
  }

  async function createOrder(body: Record<string, unknown> = {}): Promise<{ id: string }> {
    const res = await http()
      .post(`/v1/workspaces/${workspaceId}/orders`)
      .set(...owner.authHeader)
      .send({
        newClient: { name: 'Иван Петров', phone: '89991234567' },
        newVehicle: { make: 'Toyota', model: 'Camry', plate: 'a123bc77' },
        title: 'Град на капоте',
        ...body,
      })
      .expect(201);
    return res.body;
  }

  describe('создание и календарь', () => {
    it('создаёт запись и возвращает локальное время мастерской', async () => {
      const created = await createAppointment();
      expect(created.startsAtLocal).toBe(`${day}T10:00:00`);
      expect(created.endsAtLocal).toBe(`${day}T11:00:00`);
      expect(created.durationMin).toBe(60);
      expect(created.status).toBe('planned');
      expect(created.assignee.id).toBe(ownerMemberId);
    });

    it('показывает запись в диапазоне календаря', async () => {
      const created = await createAppointment();
      const from = new Date(`${day}T00:00:00Z`);
      const to = new Date(from.getTime() + 86_400_000);

      const res = await http()
        .get(`/v1/workspaces/${workspaceId}/appointments`)
        .query({ from: from.toISOString(), to: to.toISOString() })
        .set(...owner.authHeader)
        .expect(200);

      expect(res.body.timezone).toBe('Europe/Moscow');
      expect(res.body.items.map((i: { id: string }) => i.id)).toContain(created.id);
    });

    it('отклоняет слишком широкий диапазон', async () => {
      const from = new Date();
      const to = new Date(from.getTime() + 70 * 86_400_000);
      await http()
        .get(`/v1/workspaces/${workspaceId}/appointments`)
        .query({ from: from.toISOString(), to: to.toISOString() })
        .set(...owner.authHeader)
        .expect(422);
    });

    it('отклоняет время в неверном формате', async () => {
      await http()
        .post(`/v1/workspaces/${workspaceId}/appointments`)
        .set(...owner.authHeader)
        .send({ startsAtLocal: '01.05.2026 10:00', durationMin: 60 })
        .expect(422);
    });
  });

  describe('двойное бронирование', () => {
    it('возвращает 409 с конфликтами при пересечении', async () => {
      await createAppointment();

      const res = await http()
        .post(`/v1/workspaces/${workspaceId}/appointments`)
        .set(...owner.authHeader)
        .send({ startsAtLocal: `${day}T10:30`, durationMin: 60 })
        .expect(409);

      expect(res.body.error.code).toBe('overlap');
      expect(res.body.error.details.conflicts).toHaveLength(1);
      expect(res.body.error.details.canOverride).toBe(true);
    });

    it('разрешает встык без конфликта', async () => {
      await createAppointment();
      await createAppointment(owner, { startsAtLocal: `${day}T11:00` });
    });

    it('не считает конфликтом запись другого исполнителя', async () => {
      await createAppointment();
      await createAppointment(employee, { startsAtLocal: `${day}T10:00` });
    });

    it('владелец может записать поверх занятого времени', async () => {
      await createAppointment();
      const forced = await createAppointment(owner, {
        startsAtLocal: `${day}T10:30`,
        allowOverlap: true,
      });
      expect(forced.allowOverlap).toBe(true);
    });

    it('сотрудник не может снять запрет пересечения', async () => {
      await createAppointment(employee);
      const res = await http()
        .post(`/v1/workspaces/${workspaceId}/appointments`)
        .set(...employee.authHeader)
        .send({ startsAtLocal: `${day}T10:30`, durationMin: 60, allowOverlap: true })
        .expect(403);
      expect(res.body.error.code).toBe('forbidden');
    });

    it('база не даёт создать пересечение в обход приложения', async () => {
      const created = await createAppointment();
      const base = await ctx.prisma.appointment.findUniqueOrThrow({ where: { id: created.id } });

      await expect(
        ctx.prisma.appointment.create({
          data: {
            workspaceId,
            assigneeMemberId: ownerMemberId,
            startsAt: new Date(base.startsAt.getTime() + 30 * 60_000),
            endsAt: new Date(base.endsAt.getTime() + 30 * 60_000),
            status: 'planned',
          },
        }),
      ).rejects.toThrow();
    });

    it('отменённая запись освобождает время', async () => {
      const created = await createAppointment();
      await http()
        .post(`/v1/workspaces/${workspaceId}/appointments/${created.id}/status`)
        .set(...owner.authHeader)
        .send({ to: 'cancelled', reason: 'Клиент перенёс' })
        .expect(201);

      await createAppointment(owner, { startsAtLocal: `${day}T10:30` });
    });
  });

  describe('перенос и статусы', () => {
    it('переносит запись на свободное время', async () => {
      const created = await createAppointment();
      const res = await http()
        .patch(`/v1/workspaces/${workspaceId}/appointments/${created.id}`)
        .set(...owner.authHeader)
        .send({ startsAtLocal: `${day}T15:00`, durationMin: 90 })
        .expect(200);

      expect(res.body.startsAtLocal).toBe(`${day}T15:00:00`);
      expect(res.body.durationMin).toBe(90);
    });

    it('не переносит на занятое время', async () => {
      const first = await createAppointment();
      await createAppointment(owner, { startsAtLocal: `${day}T14:00` });

      await http()
        .patch(`/v1/workspaces/${workspaceId}/appointments/${first.id}`)
        .set(...owner.authHeader)
        .send({ startsAtLocal: `${day}T14:30` })
        .expect(409);
    });

    it('ведёт запись по статусам', async () => {
      const created = await createAppointment();

      const confirmed = await http()
        .post(`/v1/workspaces/${workspaceId}/appointments/${created.id}/status`)
        .set(...owner.authHeader)
        .send({ to: 'confirmed' })
        .expect(201);
      expect(confirmed.body.status).toBe('confirmed');

      const done = await http()
        .post(`/v1/workspaces/${workspaceId}/appointments/${created.id}/status`)
        .set(...owner.authHeader)
        .send({ to: 'done' })
        .expect(201);
      expect(done.body.status).toBe('done');
    });

    it('запрещает недопустимый переход статуса', async () => {
      const created = await createAppointment();
      await http()
        .post(`/v1/workspaces/${workspaceId}/appointments/${created.id}/status`)
        .set(...owner.authHeader)
        .send({ to: 'done' })
        .expect(201);

      const res = await http()
        .post(`/v1/workspaces/${workspaceId}/appointments/${created.id}/status`)
        .set(...owner.authHeader)
        .send({ to: 'cancelled' })
        .expect(409);
      expect(res.body.error.code).toBe('invalid_transition');
    });

    it('выполненную запись нельзя переносить', async () => {
      const created = await createAppointment();
      await http()
        .post(`/v1/workspaces/${workspaceId}/appointments/${created.id}/status`)
        .set(...owner.authHeader)
        .send({ to: 'done' })
        .expect(201);

      await http()
        .patch(`/v1/workspaces/${workspaceId}/appointments/${created.id}`)
        .set(...owner.authHeader)
        .send({ startsAtLocal: `${day}T16:00` })
        .expect(409);
    });

    it('вернуть отменённую запись может только владелец', async () => {
      const created = await createAppointment(employee);
      await http()
        .post(`/v1/workspaces/${workspaceId}/appointments/${created.id}/status`)
        .set(...employee.authHeader)
        .send({ to: 'cancelled', reason: 'не приехал' })
        .expect(201);

      await http()
        .post(`/v1/workspaces/${workspaceId}/appointments/${created.id}/status`)
        .set(...employee.authHeader)
        .send({ to: 'planned' })
        .expect(403);

      await http()
        .post(`/v1/workspaces/${workspaceId}/appointments/${created.id}/status`)
        .set(...owner.authHeader)
        .send({ to: 'planned' })
        .expect(201);
    });
  });

  describe('права сотрудника', () => {
    it('сотрудник не может записать на чужого исполнителя', async () => {
      await http()
        .post(`/v1/workspaces/${workspaceId}/appointments`)
        .set(...employee.authHeader)
        .send({
          startsAtLocal: `${day}T10:00`,
          durationMin: 60,
          assigneeMemberId: ownerMemberId,
        })
        .expect(403);
    });

    it('сотрудник не может перенести чужую запись', async () => {
      const created = await createAppointment(owner);
      await http()
        .patch(`/v1/workspaces/${workspaceId}/appointments/${created.id}`)
        .set(...employee.authHeader)
        .send({ startsAtLocal: `${day}T16:00` })
        .expect(404);
    });

    it('владелец может записать на сотрудника', async () => {
      const created = await createAppointment(owner, { assigneeMemberId: employeeMemberId });
      expect(created.assignee.id).toBe(employeeMemberId);
    });
  });

  describe('изоляция мастерских', () => {
    it('запись чужой мастерской не видна', async () => {
      const otherOwner = await createUser(ctx, { firstName: 'Чужой' });
      const other = await createWorkspace(ctx, { ownerUserId: otherOwner.id, name: 'Чужая' });

      const foreign = await http()
        .post(`/v1/workspaces/${other.id}/appointments`)
        .set(...otherOwner.authHeader)
        .send({ startsAtLocal: `${day}T10:00`, durationMin: 60 })
        .expect(201);

      await http()
        .get(`/v1/workspaces/${workspaceId}/appointments/${foreign.body.id}`)
        .set(...owner.authHeader)
        .expect(404);
    });
  });

  describe('свободные слоты', () => {
    it('исключает занятое время и уважает рабочие часы', async () => {
      await createAppointment();

      const res = await http()
        .get(`/v1/workspaces/${workspaceId}/appointments/availability`)
        .query({ day, durationMin: 60, stepMin: 60 })
        .set(...owner.authHeader)
        .expect(200);

      const starts = res.body.slots.map((s: { startsAtLocal: string }) => s.startsAtLocal);
      expect(starts).toContain('09:00');
      expect(starts).not.toContain('10:00');
      expect(starts).toContain('11:00');
      // Рабочий день по умолчанию заканчивается в 20:00.
      expect(starts).toContain('19:00');
      expect(starts).not.toContain('20:00');
      expect(res.body.durationMin).toBe(60);
    });

    it('учитывает рабочие часы мастерской из настроек', async () => {
      await ctx.prisma.workspace.update({
        where: { id: workspaceId },
        data: { settings: { work_day_start: '10:00', work_day_end: '13:00' } },
      });

      const res = await http()
        .get(`/v1/workspaces/${workspaceId}/appointments/availability`)
        .query({ day, durationMin: 60, stepMin: 60 })
        .set(...owner.authHeader)
        .expect(200);

      expect(res.body.slots.map((s: { startsAtLocal: string }) => s.startsAtLocal)).toEqual([
        '10:00',
        '11:00',
        '12:00',
      ]);
    });
  });

  describe('связь с заказом', () => {
    it('создаёт заказ вместе с записью и проставляет плановое время', async () => {
      const order = await createOrder({
        appointment: { startsAtLocal: `${day}T09:00`, durationMin: 120, kind: 'inspection' },
      });

      const card = await http()
        .get(`/v1/workspaces/${workspaceId}/orders/${order.id}`)
        .set(...owner.authHeader)
        .expect(200);

      expect(card.body.scheduledStartAt).not.toBeNull();

      const list = await http()
        .get(`/v1/workspaces/${workspaceId}/appointments`)
        .query({
          from: new Date(`${day}T00:00:00Z`).toISOString(),
          to: new Date(new Date(`${day}T00:00:00Z`).getTime() + 86_400_000).toISOString(),
        })
        .set(...owner.authHeader)
        .expect(200);

      expect(list.body.items).toHaveLength(1);
      expect(list.body.items[0].order.id).toBe(order.id);
      expect(list.body.items[0].kind).toBe('inspection');
    });

    it('откатывает заказ, если время записи занято', async () => {
      await createAppointment();
      const before = await ctx.prisma.order.count({ where: { workspaceId } });

      await http()
        .post(`/v1/workspaces/${workspaceId}/orders`)
        .set(...owner.authHeader)
        .send({
          newClient: { name: 'Второй клиент' },
          appointment: { startsAtLocal: `${day}T10:30`, durationMin: 60 },
        })
        .expect(409);

      expect(await ctx.prisma.order.count({ where: { workspaceId } })).toBe(before);
    });

    it('отмена заказа снимает будущие записи', async () => {
      const order = await createOrder({
        appointment: { startsAtLocal: `${day}T09:00`, durationMin: 60 },
      });

      await http()
        .post(`/v1/workspaces/${workspaceId}/orders/${order.id}/transition`)
        .set(...owner.authHeader)
        .send({ to: 'cancelled', comment: 'Клиент передумал' })
        .expect(201);

      const appointments = await ctx.prisma.appointment.findMany({ where: { workspaceId } });
      expect(appointments).toHaveLength(1);
      expect(appointments[0].status).toBe('cancelled');
      expect(appointments[0].cancelReason).toBe('Заказ отменён');

      const card = await http()
        .get(`/v1/workspaces/${workspaceId}/orders/${order.id}`)
        .set(...owner.authHeader)
        .expect(200);
      expect(card.body.scheduledStartAt).toBeNull();
    });
  });

  describe('напоминания', () => {
    it('ставит напоминание о ближайшей записи один раз', async () => {
      const startsAt = new Date(Date.now() + 30 * 60_000);
      const local = new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Europe/Moscow',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
        .format(startsAt)
        .replace(' ', 'T');

      await createAppointment(owner, { startsAtLocal: local, durationMin: 60 });

      const { AppointmentRemindersHandler } =
        await import('@/modules/crm/appointments/jobs/appointment-reminders.handler');
      const handler = ctx.app.get(AppointmentRemindersHandler);

      await handler.handle();
      await handler.handle();

      const notifications = await ctx.prisma.notification.findMany({
        where: { type: 'appointment_reminder' },
      });
      expect(notifications).toHaveLength(1);
      expect(notifications[0].userId).toBe(owner.id);
    });

    it('не напоминает об отменённой записи', async () => {
      const startsAt = new Date(Date.now() + 30 * 60_000);
      const local = new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Europe/Moscow',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
        .format(startsAt)
        .replace(' ', 'T');

      const created = await createAppointment(owner, { startsAtLocal: local, durationMin: 60 });
      await http()
        .post(`/v1/workspaces/${workspaceId}/appointments/${created.id}/status`)
        .set(...owner.authHeader)
        .send({ to: 'cancelled', reason: 'перенос' })
        .expect(201);

      const { AppointmentRemindersHandler } =
        await import('@/modules/crm/appointments/jobs/appointment-reminders.handler');
      await ctx.app.get(AppointmentRemindersHandler).handle();

      expect(await ctx.prisma.notification.count({ where: { type: 'appointment_reminder' } })).toBe(
        0,
      );
    });
  });
});
