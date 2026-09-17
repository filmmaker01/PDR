import request from 'supertest';
import { rm } from 'node:fs/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, truncateAll, type TestApp } from './helpers/app';
import { addEmployee, createUser, createWorkspace, type TestUser } from './helpers/factories';
import { FilesService } from '@/modules/files/files.service';

/** Минимальный валидный PNG 1×1. */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

describe('CRM: оплаты и фотографии заказа', () => {
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
    await rm('./storage-test', { recursive: true, force: true });
  });

  /** Согласованная смета на 10 000 ₽. */
  async function agreeEstimate(totalMinor = 1000000): Promise<void> {
    const estimate = await http()
      .post(`/v1/workspaces/${workspaceId}/orders/${orderId}/estimates`)
      .set(...owner.authHeader)
      .send({})
      .expect(201);
    await http()
      .put(`/v1/workspaces/${workspaceId}/estimates/${estimate.body.id}/items`)
      .set(...owner.authHeader)
      .send({ items: [{ title: 'Работа', quantity: 1, unitPriceMinor: totalMinor }] })
      .expect(200);
    await http()
      .post(`/v1/workspaces/${workspaceId}/estimates/${estimate.body.id}/agree`)
      .set(...owner.authHeader)
      .expect(201);
  }

  function pay(body: Record<string, unknown>, user: TestUser = owner) {
    return http()
      .post(`/v1/workspaces/${workspaceId}/orders/${orderId}/payments`)
      .set(...user.authHeader)
      .send(body);
  }

  async function uploadPng(user: TestUser = owner): Promise<string> {
    const presigned = await http()
      .post('/v1/files/presign-upload')
      .set(...user.authHeader)
      .send({
        scope: 'order_photo',
        mimeType: 'image/png',
        sizeBytes: PNG_1X1.length,
        workspaceId,
        originalName: 'before.png',
      })
      .expect(201);

    const url = new URL(presigned.body.upload.url);
    await http()
      .post(`${url.pathname}${url.search}`)
      .set('Content-Type', 'application/octet-stream')
      .send(PNG_1X1)
      .expect(201);

    await http()
      .post(`/v1/files/${presigned.body.fileId}/complete`)
      .set(...user.authHeader)
      .send({})
      .expect(201);

    await ctx.app.get(FilesService).process(presigned.body.fileId);
    return presigned.body.fileId;
  }

  describe('оплаты', () => {
    it('предоплата делает заказ частично оплаченным', async () => {
      await agreeEstimate();
      const res = await pay({ amountMinor: 300000, method: 'cash' }).expect(201);

      expect(res.body.paidMinor).toBe(300000);
      expect(res.body.paymentStatus).toBe('partial');
      expect(res.body.remainingMinor).toBe(700000);
    });

    it('доплата закрывает заказ', async () => {
      await agreeEstimate();
      await pay({ amountMinor: 300000 }).expect(201);
      const res = await pay({ amountMinor: 700000, purpose: 'final' }).expect(201);

      expect(res.body.paymentStatus).toBe('paid');
      expect(res.body.remainingMinor).toBe(0);
    });

    it('первая оплата по умолчанию считается предоплатой', async () => {
      await agreeEstimate();
      await pay({ amountMinor: 100000 }).expect(201);

      const list = await http()
        .get(`/v1/workspaces/${workspaceId}/orders/${orderId}/payments`)
        .set(...owner.authHeader)
        .expect(200);
      expect(list.body.entries[0].purpose).toBe('prepayment');
    });

    it('переплата видна в статусе', async () => {
      await agreeEstimate();
      const res = await pay({ amountMinor: 1200000 }).expect(201);
      expect(res.body.paymentStatus).toBe('overpaid');
    });

    it('корректировка уменьшает оплаченное', async () => {
      await agreeEstimate();
      const first = await pay({ amountMinor: 500000 }).expect(201);
      const res = await pay({
        kind: 'correction',
        amountMinor: 200000,
        correctsEntryId: first.body.id,
        note: 'Ошибка в сумме',
      }).expect(201);

      expect(res.body.paidMinor).toBe(300000);
      expect(res.body.paymentStatus).toBe('partial');
    });

    it('возврат больше полученного не проходит', async () => {
      await agreeEstimate();
      await pay({ amountMinor: 100000 }).expect(201);
      await pay({ kind: 'refund', amountMinor: 200000 }).expect(422);

      const list = await http()
        .get(`/v1/workspaces/${workspaceId}/orders/${orderId}/payments`)
        .set(...owner.authHeader)
        .expect(200);
      expect(list.body.paidMinor).toBe(100000);
      expect(list.body.entries).toHaveLength(1);
    });

    it('возврат обнуляет оплаченное', async () => {
      await agreeEstimate();
      const entry = await pay({ amountMinor: 400000 }).expect(201);
      const res = await pay({
        kind: 'refund',
        amountMinor: 400000,
        correctsEntryId: entry.body.id,
      }).expect(201);

      expect(res.body.paidMinor).toBe(0);
      expect(res.body.paymentStatus).toBe('unpaid');
    });

    it('нулевая и отрицательная сумма отклоняются', async () => {
      await pay({ amountMinor: 0 }).expect(422);
      await pay({ amountMinor: -100 }).expect(422);
    });

    it('дата оплаты в будущем отклоняется', async () => {
      await pay({
        amountMinor: 1000,
        occurredAt: new Date(Date.now() + 5 * 86_400_000).toISOString(),
      }).expect(422);
    });

    it('исправляемая запись должна быть из этого же заказа', async () => {
      const other = await http()
        .post(`/v1/workspaces/${workspaceId}/orders`)
        .set(...owner.authHeader)
        .send({ newClient: { name: 'Второй клиент' } })
        .expect(201);
      const foreign = await http()
        .post(`/v1/workspaces/${workspaceId}/orders/${other.body.id}/payments`)
        .set(...owner.authHeader)
        .send({ amountMinor: 100000 })
        .expect(201);

      await pay({
        kind: 'correction',
        amountMinor: 1000,
        correctsEntryId: foreign.body.id,
      }).expect(422);
    });

    it('повтор с тем же ключом идемпотентности не удваивает оплату', async () => {
      await agreeEstimate();
      const key = '11111111-2222-3333-4444-555555555555';

      await http()
        .post(`/v1/workspaces/${workspaceId}/orders/${orderId}/payments`)
        .set(...owner.authHeader)
        .set('Idempotency-Key', key)
        .send({ amountMinor: 250000 })
        .expect(201);
      await http()
        .post(`/v1/workspaces/${workspaceId}/orders/${orderId}/payments`)
        .set(...owner.authHeader)
        .set('Idempotency-Key', key)
        .send({ amountMinor: 250000 })
        .expect(201);

      const list = await http()
        .get(`/v1/workspaces/${workspaceId}/orders/${orderId}/payments`)
        .set(...owner.authHeader)
        .expect(200);
      expect(list.body.entries).toHaveLength(1);
      expect(list.body.paidMinor).toBe(250000);
    });

    it('частичная оплата видна в карточке заказа как остаток', async () => {
      await agreeEstimate();
      await pay({ amountMinor: 400000 }).expect(201);

      // Отдельного показателя задолженности больше нет: остаток считается
      // из согласованной суммы и принятых денег там, где его и смотрят.
      const order = await http()
        .get(`/v1/workspaces/${workspaceId}/orders/${orderId}/payments`)
        .set(...owner.authHeader)
        .expect(200);
      expect(order.body.paymentStatus).toBe('partial');
      expect(order.body.paidMinor).toBe(400000);
      expect(order.body.remainingMinor).toBe(600000);
    });

    it('журнал оплат доступен владельцу и закрыт для сотрудника', async () => {
      await agreeEstimate();
      await pay({ amountMinor: 100000, method: 'card' }).expect(201);

      const journal = await http()
        .get(`/v1/workspaces/${workspaceId}/payments`)
        .query({
          from: new Date(Date.now() - 86_400_000).toISOString(),
          to: new Date(Date.now() + 86_400_000).toISOString(),
        })
        .set(...owner.authHeader)
        .expect(200);
      expect(journal.body.items).toHaveLength(1);
      expect(journal.body.items[0].order.number).toBeGreaterThan(0);
      expect(journal.body.totals).toEqual([
        { kind: 'payment', method: 'card', totalMinor: 100000 },
      ]);

      await http()
        .get(`/v1/workspaces/${workspaceId}/payments`)
        .set(...employee.authHeader)
        .expect(404);
    });

    it('без права принимать оплату сотрудник получает отказ', async () => {
      await ctx.prisma.workspace.update({
        where: { id: workspaceId },
        data: { settings: { employees_can_take_payments: false } },
      });

      const own = await http()
        .post(`/v1/workspaces/${workspaceId}/orders`)
        .set(...employee.authHeader)
        .send({ newClient: { name: 'Клиент сотрудника' } })
        .expect(201);

      await http()
        .post(`/v1/workspaces/${workspaceId}/orders/${own.body.id}/payments`)
        .set(...employee.authHeader)
        .send({ amountMinor: 1000 })
        .expect(404);
    });

    it('оплаты чужой мастерской не видны', async () => {
      const otherOwner = await createUser(ctx, { firstName: 'Чужой' });
      const other = await createWorkspace(ctx, { ownerUserId: otherOwner.id, name: 'Чужая' });
      const foreignOrder = await http()
        .post(`/v1/workspaces/${other.id}/orders`)
        .set(...otherOwner.authHeader)
        .send({ newClient: { name: 'Чужой клиент' } })
        .expect(201);

      await http()
        .get(`/v1/workspaces/${workspaceId}/orders/${foreignOrder.body.id}/payments`)
        .set(...owner.authHeader)
        .expect(404);
    });
  });

  describe('фотографии заказа', () => {
    it('привязывает снимок к заказу и отдаёт ссылку на миниатюру', async () => {
      const fileId = await uploadPng();

      const attached = await http()
        .post(`/v1/workspaces/${workspaceId}/orders/${orderId}/photos`)
        .set(...owner.authHeader)
        .send({ fileId, category: 'before', caption: 'Капот' })
        .expect(201);
      expect(attached.body.category).toBe('before');

      const list = await http()
        .get(`/v1/workspaces/${workspaceId}/orders/${orderId}/photos`)
        .set(...owner.authHeader)
        .expect(200);
      expect(list.body.items).toHaveLength(1);
      expect(list.body.items[0].thumbUrl).toBeTruthy();
      expect(list.body.items[0].caption).toBe('Капот');
    });

    it('один файл нельзя привязать к заказу дважды', async () => {
      const fileId = await uploadPng();
      await http()
        .post(`/v1/workspaces/${workspaceId}/orders/${orderId}/photos`)
        .set(...owner.authHeader)
        .send({ fileId })
        .expect(201);

      const duplicate = await http()
        .post(`/v1/workspaces/${workspaceId}/orders/${orderId}/photos`)
        .set(...owner.authHeader)
        .send({ fileId })
        .expect(409);
      expect(duplicate.body.error.code).toBe('already_exists');

      const count = await ctx.prisma.orderPhoto.count({ where: { workspaceId, orderId } });
      expect(count).toBe(1);
    });

    it('меняет категорию и подпись', async () => {
      const fileId = await uploadPng();
      const photo = await http()
        .post(`/v1/workspaces/${workspaceId}/orders/${orderId}/photos`)
        .set(...owner.authHeader)
        .send({ fileId })
        .expect(201);

      const updated = await http()
        .patch(`/v1/workspaces/${workspaceId}/orders/${orderId}/photos/${photo.body.id}`)
        .set(...owner.authHeader)
        .send({ category: 'after', caption: 'После работы' })
        .expect(200);
      expect(updated.body.category).toBe('after');
      expect(updated.body.caption).toBe('После работы');
    });

    it('привязывает снимок к позиции сметы и отклоняет чужую позицию', async () => {
      const estimate = await http()
        .post(`/v1/workspaces/${workspaceId}/orders/${orderId}/estimates`)
        .set(...owner.authHeader)
        .send({})
        .expect(201);
      const withItems = await http()
        .put(`/v1/workspaces/${workspaceId}/estimates/${estimate.body.id}/items`)
        .set(...owner.authHeader)
        .send({ items: [{ title: 'Капот', quantity: 1, unitPriceMinor: 100000 }] })
        .expect(200);
      const itemId = withItems.body.items[0].id;

      const fileId = await uploadPng();
      await http()
        .post(`/v1/workspaces/${workspaceId}/orders/${orderId}/photos`)
        .set(...owner.authHeader)
        .send({ fileId, estimateItemId: itemId })
        .expect(201);

      const another = await uploadPng();
      await http()
        .post(`/v1/workspaces/${workspaceId}/orders/${orderId}/photos`)
        .set(...owner.authHeader)
        .send({ fileId: another, estimateItemId: '00000000-0000-4000-8000-000000000000' })
        .expect(422);
    });

    it('удаление снимка убирает и файл', async () => {
      const fileId = await uploadPng();
      const photo = await http()
        .post(`/v1/workspaces/${workspaceId}/orders/${orderId}/photos`)
        .set(...owner.authHeader)
        .send({ fileId })
        .expect(201);

      await http()
        .delete(`/v1/workspaces/${workspaceId}/orders/${orderId}/photos/${photo.body.id}`)
        .set(...owner.authHeader)
        .expect(204);

      const file = await ctx.prisma.storedFile.findUnique({ where: { id: fileId } });
      expect(file?.status).toBe('deleted');
      expect(await ctx.prisma.orderPhoto.count({ where: { workspaceId } })).toBe(0);
    });

    it('файл чужой мастерской привязать нельзя', async () => {
      const otherOwner = await createUser(ctx, { firstName: 'Чужой' });
      const other = await createWorkspace(ctx, { ownerUserId: otherOwner.id, name: 'Чужая' });

      const presigned = await http()
        .post('/v1/files/presign-upload')
        .set(...otherOwner.authHeader)
        .send({
          scope: 'order_photo',
          mimeType: 'image/png',
          sizeBytes: PNG_1X1.length,
          workspaceId: other.id,
        })
        .expect(201);

      await http()
        .post(`/v1/workspaces/${workspaceId}/orders/${orderId}/photos`)
        .set(...owner.authHeader)
        .send({ fileId: presigned.body.fileId })
        .expect(404);
    });

    it('отдаёт ссылку на оригинал', async () => {
      const fileId = await uploadPng();
      const photo = await http()
        .post(`/v1/workspaces/${workspaceId}/orders/${orderId}/photos`)
        .set(...owner.authHeader)
        .send({ fileId })
        .expect(201);

      const res = await http()
        .get(`/v1/workspaces/${workspaceId}/orders/${orderId}/photos/${photo.body.id}/download`)
        .set(...owner.authHeader)
        .expect(200);
      expect(res.body.url).toContain('http');
    });
  });
});
