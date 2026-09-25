import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, truncateAll, type TestApp } from './helpers/app';
import { createUser, createWorkspace, type TestUser } from './helpers/factories';
import { FilesService } from '@/modules/files/files.service';

/** Минимальный валидный PNG 1×1. */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/**
 * Карточка повреждения: фактический размер и арматурные работы детали.
 *
 * Проверяется главное расхождение из отзыва: измеренный размер и тарифная
 * зона — разные вещи, и повреждение 300×300 см не должно превращаться
 * в «100×100» ни в карточке, ни в заказе, ни в документах.
 */
describe('CRM: карточка повреждения', () => {
  let ctx: TestApp;
  let owner: TestUser;
  let workspaceId: string;
  const http = () => request(ctx.app.getHttpServer());

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    owner = await createUser(ctx, { firstName: 'Владелец' });
    const ws = await createWorkspace(ctx, { ownerUserId: owner.id, name: 'Кузовной цех' });
    workspaceId = ws.id;
  });

  async function createLead(): Promise<string> {
    const res = await http()
      .post(`/v1/workspaces/${workspaceId}/leads`)
      .set(...owner.authHeader)
      .send({ contactName: 'Пётр', contactPhone: '+79001234567' })
      .expect(201);
    return res.body.id as string;
  }

  async function uploadPng(): Promise<string> {
    const presigned = await http()
      .post('/v1/files/presign-upload')
      .set(...owner.authHeader)
      .send({
        scope: 'order_photo',
        mimeType: 'image/png',
        sizeBytes: PNG_1X1.length,
        workspaceId,
        originalName: 'damage.png',
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
      .set(...owner.authHeader)
      .send({})
      .expect(201);
    await ctx.app.get(FilesService).process(presigned.body.fileId);
    return presigned.body.fileId as string;
  }

  async function createWork(title: string, priceMinor: number): Promise<string> {
    const res = await http()
      .post(`/v1/workspaces/${workspaceId}/price-list`)
      .set(...owner.authHeader)
      .send({ kind: 'disassembly', title, unitPriceMinor: priceMinor })
      .expect(201);
    return res.body.id as string;
  }

  describe('фактический размер', () => {
    it('крупное повреждение не подменяется размером тарифной зоны', async () => {
      const leadId = await createLead();
      const res = await http()
        .post(`/v1/workspaces/${workspaceId}/leads/${leadId}/damages`)
        .set(...owner.authHeader)
        .send({ panelCode: 'hood', damageType: 'dent', widthMm: 3000, heightMm: 3000 })
        .expect(201);

      expect(res.body.widthMm).toBe(3000);
      expect(res.body.heightMm).toBe(3000);
      expect(res.body.sizeText).toBe('300 × 300 см');
      // Цена считается по верхней зоне, но размером она не притворяется.
      expect(res.body.sizeClass).toBe('100x100');
      expect(res.body.zoneLabel).toBe('100×100+');
      expect(res.body.zoneCapped).toBe(true);
    });

    it('размер внутри сетки показывает зону без плюса', async () => {
      const leadId = await createLead();
      const res = await http()
        .post(`/v1/workspaces/${workspaceId}/leads/${leadId}/damages`)
        .set(...owner.authHeader)
        .send({ panelCode: 'door_fl', widthMm: 400, heightMm: 400 })
        .expect(201);

      expect(res.body.sizeText).toBe('40 × 40 см');
      expect(res.body.zoneLabel).toBe('40×40');
      expect(res.body.zoneCapped).toBe(false);
    });

    it('размеры переживают конверсию обращения в заказ', async () => {
      const leadId = await createLead();
      await http()
        .post(`/v1/workspaces/${workspaceId}/leads/${leadId}/damages`)
        .set(...owner.authHeader)
        .send({ panelCode: 'hood', widthMm: 3000, heightMm: 3000, priceMinor: 1_200_000 })
        .expect(201);

      const converted = await http()
        .post(`/v1/workspaces/${workspaceId}/leads/${leadId}/convert`)
        .set(...owner.authHeader)
        .send({})
        .expect(201);

      const damages = await http()
        .get(`/v1/workspaces/${workspaceId}/orders/${converted.body.orderId}/damages`)
        .set(...owner.authHeader)
        .expect(200);

      expect(damages.body.items).toHaveLength(1);
      expect(damages.body.items[0]).toMatchObject({
        widthMm: 3000,
        heightMm: 3000,
        sizeText: '300 × 300 см',
        priceMinor: 1_200_000,
      });
    });
  });

  describe('арматурные работы детали', () => {
    it('сохраняются вместе с повреждением и дают итог по детали', async () => {
      const leadId = await createLead();
      const workId = await createWork('Разбор двери', 200_000);

      const res = await http()
        .post(`/v1/workspaces/${workspaceId}/leads/${leadId}/damages`)
        .set(...owner.authHeader)
        .send({
          panelCode: 'door_fl',
          widthMm: 400,
          heightMm: 400,
          priceMinor: 800_000,
          extraWorks: [
            { priceListItemId: workId },
            { title: 'Снятие подкрылка', unitPriceMinor: 120_000 },
          ],
        })
        .expect(201);

      expect(res.body.extraWorks).toHaveLength(2);
      // Название и цена берутся из справочника, а не из того, что прислали.
      expect(res.body.extraWorks[0]).toMatchObject({
        title: 'Разбор двери',
        unitPriceMinor: 200_000,
      });
      expect(res.body.extrasMinor).toBe(320_000);
      expect(res.body.totalMinor).toBe(1_120_000);
    });

    it('набор работ заменяется целиком', async () => {
      const leadId = await createLead();
      const workId = await createWork('Снятие обшивки двери', 150_000);

      const created = await http()
        .post(`/v1/workspaces/${workspaceId}/leads/${leadId}/damages`)
        .set(...owner.authHeader)
        .send({ panelCode: 'door_fl', extraWorks: [{ priceListItemId: workId }] })
        .expect(201);

      const updated = await http()
        .patch(`/v1/workspaces/${workspaceId}/damages/${created.body.id}`)
        .set(...owner.authHeader)
        .send({ extraWorks: [] })
        .expect(200);

      expect(updated.body.extraWorks).toHaveLength(0);
      expect(updated.body.extrasMinor).toBe(0);
    });

    it('правка размера не трогает работы', async () => {
      const leadId = await createLead();
      const workId = await createWork('Разбор двери', 200_000);

      const created = await http()
        .post(`/v1/workspaces/${workspaceId}/leads/${leadId}/damages`)
        .set(...owner.authHeader)
        .send({
          panelCode: 'door_fl',
          widthMm: 400,
          heightMm: 400,
          extraWorks: [{ priceListItemId: workId }],
        })
        .expect(201);

      const updated = await http()
        .patch(`/v1/workspaces/${workspaceId}/damages/${created.body.id}`)
        .set(...owner.authHeader)
        .send({ widthMm: 600, heightMm: 600 })
        .expect(200);

      expect(updated.body.sizeText).toBe('60 × 60 см');
      expect(updated.body.extraWorks).toHaveLength(1);
    });

    it('позиция прайса для повреждений арматурной работой не становится', async () => {
      const leadId = await createLead();
      const damageItem = await http()
        .post(`/v1/workspaces/${workspaceId}/price-list`)
        .set(...owner.authHeader)
        .send({ kind: 'damage', title: 'Зона 40×40', sizeClass: '40x40', unitPriceMinor: 900_000 })
        .expect(201);

      await http()
        .post(`/v1/workspaces/${workspaceId}/leads/${leadId}/damages`)
        .set(...owner.authHeader)
        .send({ panelCode: 'door_fl', extraWorks: [{ priceListItemId: damageItem.body.id }] })
        .expect(422);
    });

    it('работы уходят вместе с обращением, созданным одним запросом', async () => {
      const workId = await createWork('Снятие бампера', 250_000);
      const lead = await http()
        .post(`/v1/workspaces/${workspaceId}/leads`)
        .set(...owner.authHeader)
        .send({
          contactName: 'Пётр',
          damages: [
            {
              panelCode: 'front_bumper',
              widthMm: 400,
              heightMm: 400,
              extraWorks: [{ priceListItemId: workId }],
            },
          ],
        })
        .expect(201);

      const damages = await http()
        .get(`/v1/workspaces/${workspaceId}/leads/${lead.body.id}/damages`)
        .set(...owner.authHeader)
        .expect(200);

      expect(damages.body.items[0].extraWorks).toHaveLength(1);
      expect(damages.body.items[0].extrasMinor).toBe(250_000);
    });

    it('снятие повреждения уносит его работы', async () => {
      const leadId = await createLead();
      const workId = await createWork('Разбор двери', 200_000);
      const created = await http()
        .post(`/v1/workspaces/${workspaceId}/leads/${leadId}/damages`)
        .set(...owner.authHeader)
        .send({ panelCode: 'door_fl', extraWorks: [{ priceListItemId: workId }] })
        .expect(201);

      await http()
        .delete(`/v1/workspaces/${workspaceId}/damages/${created.body.id}`)
        .set(...owner.authHeader)
        .expect(204);

      const left = await ctx.prisma.damageExtraWork.count({ where: { workspaceId } });
      expect(left).toBe(0);
    });
  });

  describe('смета помнит фактический размер', () => {
    it('позиция сметы хранит габариты и отдаёт готовую подпись', async () => {
      const order = await http()
        .post(`/v1/workspaces/${workspaceId}/orders`)
        .set(...owner.authHeader)
        .send({ newClient: { name: 'Пётр' }, title: 'Капот' })
        .expect(201);

      const estimate = await http()
        .post(`/v1/workspaces/${workspaceId}/orders/${order.body.id}/estimates`)
        .set(...owner.authHeader)
        .send({})
        .expect(201);

      const saved = await http()
        .put(`/v1/workspaces/${workspaceId}/estimates/${estimate.body.id}/items`)
        .set(...owner.authHeader)
        .send({
          items: [
            {
              title: 'Капот, вмятина',
              panelCode: 'hood',
              sizeClass: '100x100',
              widthMm: 3000,
              heightMm: 3000,
              quantity: 1,
              unitPriceMinor: 1_200_000,
            },
          ],
        })
        .expect(200);

      expect(saved.body.items[0]).toMatchObject({
        widthMm: 3000,
        heightMm: 3000,
        sizeText: '300 × 300 см',
      });
    });
  });

  describe('новый заказ сразу с повреждениями', () => {
    it('капот и дверь из формы попадают в заказ со всеми параметрами, работами и фото', async () => {
      const workId = await createWork('Снятие обшивки двери', 150000);
      const hoodPhoto = await uploadPng();
      const hoodMarkup = await uploadPng();
      const doorPhoto = await uploadPng();
      const loosePhoto = await uploadPng();
      const circle = { v: 1, shapes: [{ type: 'circle', cx: 0.5, cy: 0.5, rx: 0.2, ry: 0.1 }] };

      const created = await http()
        .post(`/v1/workspaces/${workspaceId}/orders`)
        .set(...owner.authHeader)
        .send({
          newClient: { name: 'Олег', phone: '+79272666022' },
          newVehicle: { make: 'Toyota', model: 'Camry' },
          damages: [
            {
              panelCode: 'hood',
              damageType: 'dent',
              widthMm: 3000,
              heightMm: 3000,
              quantity: 2,
              material: 'aluminum',
              accessDifficulty: 'medium',
              onEdge: true,
              priceMinor: 3450000,
              extraWorks: [{ title: 'Снятие шумоизоляции', unitPriceMinor: 200000 }],
            },
            {
              panelCode: 'door_fl',
              damageType: 'dent',
              widthMm: 400,
              heightMm: 400,
              material: 'steel',
              accessDifficulty: 'hard',
              onEdge: false,
              priceMinor: 900000,
              extraWorks: [{ priceListItemId: workId }],
            },
          ],
          photos: [
            { fileId: hoodPhoto, damageIndex: 0, annotation: circle, annotationFileId: hoodMarkup },
            { fileId: doorPhoto, damageIndex: 1 },
            { fileId: loosePhoto },
          ],
        })
        .expect(201);
      expect(created.body.photos).toEqual({ attached: 3, failed: [], markupFailed: 0 });
      const orderId = created.body.id as string;

      // То, что читает вкладка «Повреждения» и схема: обе детали на месте.
      const list = await http()
        .get(`/v1/workspaces/${workspaceId}/orders/${orderId}/damages`)
        .set(...owner.authHeader)
        .expect(200);
      expect(list.body.items.map((d: { panelCode: string }) => d.panelCode)).toEqual([
        'hood',
        'door_fl',
      ]);
      const [hood, door] = list.body.items;
      expect(hood).toMatchObject({
        damageType: 'dent',
        widthMm: 3000,
        heightMm: 3000,
        sizeText: '300 × 300 см',
        quantity: 2,
        material: 'aluminum',
        accessDifficulty: 'medium',
        onEdge: true,
        priceMinor: 3450000,
        extrasMinor: 200000,
        totalMinor: 3650000,
      });
      expect(hood.extraWorks).toHaveLength(1);
      expect(hood.extraWorks[0].title).toBe('Снятие шумоизоляции');
      expect(door).toMatchObject({
        widthMm: 400,
        material: 'steel',
        accessDifficulty: 'hard',
        onEdge: false,
        priceMinor: 900000,
        extrasMinor: 150000,
      });
      expect(door.extraWorks[0].priceListItemId).toBe(workId);

      const photos = await http()
        .get(`/v1/workspaces/${workspaceId}/orders/${orderId}/photos`)
        .set(...owner.authHeader)
        .expect(200);
      const byFile = (fileId: string) =>
        photos.body.items.find((p: { fileId: string }) => p.fileId === fileId);
      expect(byFile(hoodPhoto)).toMatchObject({
        damageId: hood.id,
        hasMarkup: true,
        annotationFileId: hoodMarkup,
      });
      expect(byFile(hoodPhoto).annotation).toEqual(circle);
      expect(byFile(doorPhoto)).toMatchObject({ damageId: door.id, hasMarkup: false });
      expect(byFile(loosePhoto).damageId).toBeNull();
    });

    it('ошибка в повреждении не создаёт заказ без схемы', async () => {
      await http()
        .post(`/v1/workspaces/${workspaceId}/orders`)
        .set(...owner.authHeader)
        .send({
          newClient: { name: 'Олег' },
          damages: [
            { panelCode: 'hood' },
            // Позиция чужого справочника: работа не найдётся.
            {
              panelCode: 'door_fl',
              extraWorks: [{ priceListItemId: '00000000-0000-4000-8000-000000000000' }],
            },
          ],
        })
        .expect((res) => expect(res.status).toBeGreaterThanOrEqual(400));

      const orders = await http()
        .get(`/v1/workspaces/${workspaceId}/orders`)
        .set(...owner.authHeader)
        .expect(200);
      expect(orders.body.items).toHaveLength(0);
    });
  });
});
