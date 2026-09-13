import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, truncateAll, type TestApp } from './helpers/app';
import { addEmployee, createUser, createWorkspace, type TestUser } from './helpers/factories';

describe('CRM: прайс и сметы', () => {
  let ctx: TestApp;
  let owner: TestUser;
  let employee: TestUser;
  let workspaceId: string;
  let orderId: string;
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
    await addEmployee(ctx, workspaceId, employee.id);

    const order = await http()
      .post(`/v1/workspaces/${workspaceId}/orders`)
      .set(...owner.authHeader)
      .send({
        newClient: { name: 'Иван Петров', phone: '89991234567' },
        newVehicle: { make: 'Toyota', model: 'Camry', plate: 'a123bc77' },
        title: 'Град на капоте',
      })
      .expect(201);
    orderId = order.body.id;
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function createPriceItem(
    body: Record<string, unknown> = {},
  ): Promise<{ id: string; unitPriceMinor: number }> {
    const res = await http()
      .post(`/v1/workspaces/${workspaceId}/price-list`)
      .set(...owner.authHeader)
      .send({ title: 'Капот, вмятина S', unitPriceMinor: 150000, ...body })
      .expect(201);
    return res.body;
  }

  async function createEstimate(
    user: TestUser = owner,
  ): Promise<{ id: string; versionNo: number }> {
    const res = await http()
      .post(`/v1/workspaces/${workspaceId}/orders/${orderId}/estimates`)
      .set(...user.authHeader)
      .send({})
      .expect(201);
    return res.body;
  }

  function setItems(estimateId: string, items: Record<string, unknown>[], user: TestUser = owner) {
    return http()
      .put(`/v1/workspaces/${workspaceId}/estimates/${estimateId}/items`)
      .set(...user.authHeader)
      .send({ items });
  }

  describe('прайс', () => {
    it('владелец добавляет позицию, сотрудник видит её', async () => {
      await createPriceItem();
      const res = await http()
        .get(`/v1/workspaces/${workspaceId}/price-list`)
        .set(...employee.authHeader)
        .expect(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].unitPriceMinor).toBe(150000);
    });

    it('сотрудник не может менять прайс', async () => {
      await http()
        .post(`/v1/workspaces/${workspaceId}/price-list`)
        .set(...employee.authHeader)
        .send({ title: 'Своя цена', unitPriceMinor: 1 })
        .expect(404);
    });

    it('неиспользованная позиция удаляется, использованная — деактивируется', async () => {
      const unused = await createPriceItem({ title: 'Не пригодилась' });
      const used = await createPriceItem({ title: 'В смете' });

      const estimate = await createEstimate();
      await setItems(estimate.id, [{ priceListItemId: used.id, quantity: 2 }]).expect(200);

      const first = await http()
        .delete(`/v1/workspaces/${workspaceId}/price-list/${unused.id}`)
        .set(...owner.authHeader)
        .expect(200);
      expect(first.body.deleted).toBe(true);

      const second = await http()
        .delete(`/v1/workspaces/${workspaceId}/price-list/${used.id}`)
        .set(...owner.authHeader)
        .expect(200);
      expect(second.body.deleted).toBe(false);

      const active = await http()
        .get(`/v1/workspaces/${workspaceId}/price-list`)
        .set(...owner.authHeader)
        .expect(200);
      expect(active.body).toHaveLength(0);
    });

    it('отдаёт справочники элементов кузова и повреждений', async () => {
      const res = await http()
        .get(`/v1/workspaces/${workspaceId}/pdr-dictionaries`)
        .set(...owner.authHeader)
        .expect(200);
      expect(res.body.panels.some((p: { code: string }) => p.code === 'hood')).toBe(true);
      expect(res.body.damageTypes.some((d: { code: string }) => d.code === 'hail')).toBe(true);
      expect(res.body.sizeClasses).toHaveLength(4);
    });
  });

  describe('составление сметы', () => {
    it('считает итоги на сервере', async () => {
      const estimate = await createEstimate();
      const res = await setItems(estimate.id, [
        { title: 'Капот, град', quantity: 12, unitPriceMinor: 100000 },
        {
          kind: 'disassembly',
          title: 'Снять/поставить потолок',
          quantity: 1,
          unitPriceMinor: 500000,
        },
      ]).expect(200);

      expect(res.body.subtotalMinor).toBe(12 * 100000 + 500000);
      expect(res.body.totalMinor).toBe(1700000);
      expect(res.body.items[0].lineTotalMinor).toBe(1200000);
    });

    it('берёт цену и название из прайса', async () => {
      const price = await createPriceItem({
        title: 'Крыша, град, M',
        unitPriceMinor: 220000,
        panelCode: 'roof',
        damageType: 'hail',
        sizeClass: 'M',
      });
      const estimate = await createEstimate();

      const res = await setItems(estimate.id, [{ priceListItemId: price.id, quantity: 3 }]).expect(
        200,
      );

      expect(res.body.items[0].title).toBe('Крыша, град, M');
      expect(res.body.items[0].unitPriceMinor).toBe(220000);
      expect(res.body.items[0].panelCode).toBe('roof');
      expect(res.body.totalMinor).toBe(660000);
    });

    it('собирает название позиции из справочников, если его не передали', async () => {
      const estimate = await createEstimate();
      const res = await setItems(estimate.id, [
        {
          panelCode: 'hood',
          damageType: 'hail',
          quantity: 12,
          sizeClass: 'S',
          unitPriceMinor: 1000,
        },
      ]).expect(200);
      expect(res.body.items[0].title).toBe('Капот — град, 12 шт, S');
    });

    it('требует цену, если позиция не из прайса', async () => {
      const estimate = await createEstimate();
      await setItems(estimate.id, [{ title: 'Без цены', quantity: 1 }]).expect(422);
    });

    it('применяет процентную скидку', async () => {
      const estimate = await createEstimate();
      await setItems(estimate.id, [
        { title: 'Работа', quantity: 1, unitPriceMinor: 100000 },
      ]).expect(200);

      const res = await http()
        .patch(`/v1/workspaces/${workspaceId}/estimates/${estimate.id}`)
        .set(...owner.authHeader)
        .send({ discountKind: 'percent', discountValue: 10 })
        .expect(200);

      expect(res.body.discountMinor).toBe(10000);
      expect(res.body.totalMinor).toBe(90000);
    });

    it('пересчитывает скидку при замене позиций', async () => {
      const estimate = await createEstimate();
      await setItems(estimate.id, [
        { title: 'Работа', quantity: 1, unitPriceMinor: 100000 },
      ]).expect(200);
      await http()
        .patch(`/v1/workspaces/${workspaceId}/estimates/${estimate.id}`)
        .set(...owner.authHeader)
        .send({ discountKind: 'fixed', discountValue: 20000 })
        .expect(200);

      const res = await setItems(estimate.id, [
        { title: 'Работа', quantity: 2, unitPriceMinor: 100000 },
      ]).expect(200);

      expect(res.body.subtotalMinor).toBe(200000);
      expect(res.body.discountMinor).toBe(20000);
      expect(res.body.totalMinor).toBe(180000);
    });

    it('не пропускает скидку больше 100 процентов', async () => {
      const estimate = await createEstimate();
      await http()
        .patch(`/v1/workspaces/${workspaceId}/estimates/${estimate.id}`)
        .set(...owner.authHeader)
        .send({ discountKind: 'percent', discountValue: 120 })
        .expect(422);
    });

    it('не даёт создать второй черновик', async () => {
      await createEstimate();
      const res = await http()
        .post(`/v1/workspaces/${workspaceId}/orders/${orderId}/estimates`)
        .set(...owner.authHeader)
        .send({})
        .expect(409);
      expect(res.body.error.code).toBe('conflict');
    });
  });

  describe('согласование', () => {
    async function readyEstimate(): Promise<{ id: string; versionNo: number }> {
      const estimate = await createEstimate();
      await setItems(estimate.id, [
        { title: 'Капот, град', quantity: 10, unitPriceMinor: 100000 },
      ]).expect(200);
      return estimate;
    }

    it('отправка переводит заказ на согласование', async () => {
      const estimate = await readyEstimate();
      const sent = await http()
        .post(`/v1/workspaces/${workspaceId}/estimates/${estimate.id}/send`)
        .set(...owner.authHeader)
        .expect(201);
      expect(sent.body.status).toBe('sent');

      const order = await http()
        .get(`/v1/workspaces/${workspaceId}/orders/${orderId}`)
        .set(...owner.authHeader)
        .expect(200);
      expect(order.body.status).toBe('pending_approval');
    });

    it('пустую смету отправить нельзя', async () => {
      const estimate = await createEstimate();
      await http()
        .post(`/v1/workspaces/${workspaceId}/estimates/${estimate.id}/send`)
        .set(...owner.authHeader)
        .expect(422);
    });

    it('согласование фиксирует сумму в заказе', async () => {
      const estimate = await readyEstimate();
      await http()
        .post(`/v1/workspaces/${workspaceId}/estimates/${estimate.id}/agree`)
        .set(...owner.authHeader)
        .expect(201);

      const order = await http()
        .get(`/v1/workspaces/${workspaceId}/orders/${orderId}`)
        .set(...owner.authHeader)
        .expect(200);
      expect(order.body.agreedTotalMinor).toBe(1000000);
      expect(order.body.paymentStatus).toBe('unpaid');
      expect(
        order.body.history.some((h: { comment: string }) => h.comment?.includes('согласована')),
      ).toBe(true);
    });

    it('согласованную смету не редактируют', async () => {
      const estimate = await readyEstimate();
      await http()
        .post(`/v1/workspaces/${workspaceId}/estimates/${estimate.id}/agree`)
        .set(...owner.authHeader)
        .expect(201);

      const res = await setItems(estimate.id, [
        { title: 'Ещё работа', quantity: 1, unitPriceMinor: 1000 },
      ]).expect(409);
      expect(res.body.error.code).toBe('estimate_immutable');
    });

    it('новая версия заменяет согласованную только после согласования', async () => {
      const first = await readyEstimate();
      await http()
        .post(`/v1/workspaces/${workspaceId}/estimates/${first.id}/agree`)
        .set(...owner.authHeader)
        .expect(201);

      const second = await http()
        .post(`/v1/workspaces/${workspaceId}/estimates/${first.id}/new-version`)
        .set(...owner.authHeader)
        .expect(201);
      expect(second.body.versionNo).toBe(2);

      // Пока новая версия не согласована, действует прежняя.
      const afterCopy = await http()
        .get(`/v1/workspaces/${workspaceId}/estimates/${first.id}`)
        .set(...owner.authHeader)
        .expect(200);
      expect(afterCopy.body.status).toBe('agreed');

      await setItems(second.body.id, [
        { title: 'Капот, град', quantity: 14, unitPriceMinor: 100000 },
      ]).expect(200);
      await http()
        .post(`/v1/workspaces/${workspaceId}/estimates/${second.body.id}/agree`)
        .set(...owner.authHeader)
        .expect(201);

      const previous = await http()
        .get(`/v1/workspaces/${workspaceId}/estimates/${first.id}`)
        .set(...owner.authHeader)
        .expect(200);
      expect(previous.body.status).toBe('superseded');

      const order = await http()
        .get(`/v1/workspaces/${workspaceId}/orders/${orderId}`)
        .set(...owner.authHeader)
        .expect(200);
      expect(order.body.agreedTotalMinor).toBe(1400000);

      const agreedCount = await ctx.prisma.estimate.count({
        where: { workspaceId, orderId, status: 'agreed' },
      });
      expect(agreedCount).toBe(1);
    });

    it('новая версия отправленной сметы отменяет её', async () => {
      const estimate = await readyEstimate();
      await http()
        .post(`/v1/workspaces/${workspaceId}/estimates/${estimate.id}/send`)
        .set(...owner.authHeader)
        .expect(201);

      await http()
        .post(`/v1/workspaces/${workspaceId}/estimates/${estimate.id}/new-version`)
        .set(...owner.authHeader)
        .expect(201);

      const source = await http()
        .get(`/v1/workspaces/${workspaceId}/estimates/${estimate.id}`)
        .set(...owner.authHeader)
        .expect(200);
      expect(source.body.status).toBe('superseded');
    });

    it('из черновика новую версию не делают', async () => {
      const estimate = await readyEstimate();
      await http()
        .post(`/v1/workspaces/${workspaceId}/estimates/${estimate.id}/new-version`)
        .set(...owner.authHeader)
        .expect(409);
    });

    it('копия версии сохраняет позиции и скидку', async () => {
      const estimate = await readyEstimate();
      await http()
        .patch(`/v1/workspaces/${workspaceId}/estimates/${estimate.id}`)
        .set(...owner.authHeader)
        .send({ discountKind: 'percent', discountValue: 5 })
        .expect(200);
      await http()
        .post(`/v1/workspaces/${workspaceId}/estimates/${estimate.id}/send`)
        .set(...owner.authHeader)
        .expect(201);

      const next = await http()
        .post(`/v1/workspaces/${workspaceId}/estimates/${estimate.id}/new-version`)
        .set(...owner.authHeader)
        .expect(201);

      const copy = await http()
        .get(`/v1/workspaces/${workspaceId}/estimates/${next.body.id}`)
        .set(...owner.authHeader)
        .expect(200);
      expect(copy.body.items).toHaveLength(1);
      expect(copy.body.discountValue).toBe(5);
      expect(copy.body.totalMinor).toBe(950000);
    });

    it('отклонение фиксирует причину', async () => {
      const estimate = await readyEstimate();
      await http()
        .post(`/v1/workspaces/${workspaceId}/estimates/${estimate.id}/send`)
        .set(...owner.authHeader)
        .expect(201);

      const res = await http()
        .post(`/v1/workspaces/${workspaceId}/estimates/${estimate.id}/reject`)
        .set(...owner.authHeader)
        .send({ reason: 'Дорого' })
        .expect(201);
      expect(res.body.status).toBe('rejected');
      expect(res.body.rejectReason).toBe('Дорого');
    });
  });

  describe('прайс и старые сметы', () => {
    it('изменение прайса не трогает уже составленную смету', async () => {
      const price = await createPriceItem({ unitPriceMinor: 100000 });
      const estimate = await createEstimate();
      await setItems(estimate.id, [{ priceListItemId: price.id, quantity: 1 }]).expect(200);

      await http()
        .patch(`/v1/workspaces/${workspaceId}/price-list/${price.id}`)
        .set(...owner.authHeader)
        .send({ unitPriceMinor: 200000 })
        .expect(200);

      const after = await http()
        .get(`/v1/workspaces/${workspaceId}/estimates/${estimate.id}`)
        .set(...owner.authHeader)
        .expect(200);
      expect(after.body.items[0].unitPriceMinor).toBe(100000);
      expect(after.body.totalMinor).toBe(100000);
    });
  });

  describe('печатная форма', () => {
    it('отдаёт PDF', async () => {
      const estimate = await createEstimate();
      await setItems(estimate.id, [
        {
          panelCode: 'hood',
          damageType: 'hail',
          quantity: 12,
          sizeClass: 'S',
          unitPriceMinor: 90000,
        },
      ]).expect(200);

      const res = await http()
        .get(`/v1/workspaces/${workspaceId}/estimates/${estimate.id}/pdf`)
        .set(...owner.authHeader)
        .buffer(true)
        .parse((response, callback) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', () => callback(null, Buffer.concat(chunks)));
        })
        .expect(200);

      expect(res.headers['content-type']).toContain('application/pdf');
      expect((res.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
      expect((res.body as Buffer).length).toBeGreaterThan(1000);
    });
  });

  describe('права и изоляция', () => {
    it('сотрудник составляет смету по своему заказу', async () => {
      const own = await http()
        .post(`/v1/workspaces/${workspaceId}/orders`)
        .set(...employee.authHeader)
        .send({ newClient: { name: 'Клиент сотрудника' }, title: 'Дверь' })
        .expect(201);

      await http()
        .post(`/v1/workspaces/${workspaceId}/orders/${own.body.id}/estimates`)
        .set(...employee.authHeader)
        .send({})
        .expect(201);
    });

    it('без права правки смет сотрудник получает отказ', async () => {
      await ctx.prisma.workspace.update({
        where: { id: workspaceId },
        data: { settings: { employees_can_edit_estimates: false } },
      });

      const own = await http()
        .post(`/v1/workspaces/${workspaceId}/orders`)
        .set(...employee.authHeader)
        .send({ newClient: { name: 'Клиент сотрудника' }, title: 'Дверь' })
        .expect(201);

      await http()
        .post(`/v1/workspaces/${workspaceId}/orders/${own.body.id}/estimates`)
        .set(...employee.authHeader)
        .send({})
        .expect(404);
    });

    it('смета чужой мастерской недоступна', async () => {
      const otherOwner = await createUser(ctx, { firstName: 'Чужой' });
      const other = await createWorkspace(ctx, { ownerUserId: otherOwner.id, name: 'Чужая' });
      const foreignOrder = await http()
        .post(`/v1/workspaces/${other.id}/orders`)
        .set(...otherOwner.authHeader)
        .send({ newClient: { name: 'Чужой клиент' } })
        .expect(201);
      const foreign = await http()
        .post(`/v1/workspaces/${other.id}/orders/${foreignOrder.body.id}/estimates`)
        .set(...otherOwner.authHeader)
        .send({})
        .expect(201);

      await http()
        .get(`/v1/workspaces/${workspaceId}/estimates/${foreign.body.id}`)
        .set(...owner.authHeader)
        .expect(404);
    });
  });
});
