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

describe('CRM: обращения, повреждения, оценки', () => {
  let ctx: TestApp;
  let owner: TestUser;
  let employee: TestUser;
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
    await addEmployee(ctx, workspaceId, employee.id);
  });

  afterAll(async () => {
    await ctx.close();
    await rm('./storage-test', { recursive: true, force: true });
  });

  async function uploadPng(user: TestUser = owner): Promise<string> {
    const presigned = await http()
      .post('/v1/files/presign-upload')
      .set(...user.authHeader)
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
      .set(...user.authHeader)
      .send({})
      .expect(201);

    await ctx.app.get(FilesService).process(presigned.body.fileId);
    return presigned.body.fileId;
  }

  async function createLead(body: Record<string, unknown> = {}): Promise<string> {
    const res = await http()
      .post(`/v1/workspaces/${workspaceId}/leads`)
      .set(...owner.authHeader)
      .send({
        contactName: 'Марина',
        contactPhone: '89031234567',
        vehicleMake: 'Kia',
        vehicleModel: 'Rio',
        channel: 'telegram',
        comment: 'Вмятина на двери',
        ...body,
      })
      .expect(201);
    return res.body.id;
  }

  /** Прайс с позицией на дверь: без него расчёт не может предложить цену. */
  async function seedPriceList(): Promise<void> {
    await http()
      .post(`/v1/workspaces/${workspaceId}/price-list`)
      .set(...owner.authHeader)
      .send({
        title: 'Дверь, парковочная M',
        panelCode: 'door_fl',
        damageType: 'door_ding',
        sizeClass: 'M',
        unitPriceMinor: 450000,
      })
      .expect(201);
  }

  describe('создание и статусы', () => {
    it('создаёт обращение без клиента в базе', async () => {
      const leadId = await createLead();

      const card = await http()
        .get(`/v1/workspaces/${workspaceId}/leads/${leadId}`)
        .set(...owner.authHeader)
        .expect(200);

      expect(card.body.number).toBe(1);
      expect(card.body.status).toBe('new');
      // Канал определяет источник сам: из Telegram лично не приходят.
      expect(card.body.source).toBe('online');
      expect(card.body.contact.clientId).toBeNull();
      expect(card.body.contact.phone).toBe('+79031234567');
      expect(card.body.history).toHaveLength(1);

      // Справочник клиентов не засоряется холодными контактами.
      const clients = await http()
        .get(`/v1/workspaces/${workspaceId}/clients`)
        .set(...owner.authHeader)
        .expect(200);
      expect(clients.body.items).toHaveLength(0);
    });

    it('отказывает, если не указан никакой контакт', async () => {
      await http()
        .post(`/v1/workspaces/${workspaceId}/leads`)
        .set(...owner.authHeader)
        .send({ vehicleMake: 'Kia', vehicleModel: 'Rio' })
        .expect(422);
    });

    it('связывает обращение с существующим клиентом', async () => {
      const client = await http()
        .post(`/v1/workspaces/${workspaceId}/clients`)
        .set(...owner.authHeader)
        .send({ name: 'Иван Петров', phone: '89991234567' })
        .expect(201);

      const leadId = await createLead({ clientId: client.body.id, contactName: null });
      const card = await http()
        .get(`/v1/workspaces/${workspaceId}/leads/${leadId}`)
        .set(...owner.authHeader)
        .expect(200);

      expect(card.body.contact.clientId).toBe(client.body.id);
      expect(card.body.contact.name).toBe('Иван Петров');
    });

    it('переводит статусы по разрешённым переходам', async () => {
      const leadId = await createLead();

      const estimated = await http()
        .post(`/v1/workspaces/${workspaceId}/leads/${leadId}/transition`)
        .set(...owner.authHeader)
        .send({ to: 'estimated' })
        .expect(201);
      expect(estimated.body.status).toBe('estimated');

      // Вернуться в «Новое» нельзя ниоткуда: воронка не идёт назад.
      await http()
        .post(`/v1/workspaces/${workspaceId}/leads/${leadId}/transition`)
        .set(...owner.authHeader)
        .send({ to: 'new' })
        .expect(409);
    });

    it('требует дату для «перезвонить» и причину для отказа', async () => {
      const leadId = await createLead();

      await http()
        .post(`/v1/workspaces/${workspaceId}/leads/${leadId}/transition`)
        .set(...owner.authHeader)
        .send({ to: 'callback' })
        .expect(422);

      const at = new Date(Date.now() + 86_400_000).toISOString();
      await http()
        .post(`/v1/workspaces/${workspaceId}/leads/${leadId}/transition`)
        .set(...owner.authHeader)
        .send({ to: 'callback', nextContactAt: at })
        .expect(201);

      await http()
        .post(`/v1/workspaces/${workspaceId}/leads/${leadId}/transition`)
        .set(...owner.authHeader)
        .send({ to: 'rejected' })
        .expect(422);

      await http()
        .post(`/v1/workspaces/${workspaceId}/leads/${leadId}/transition`)
        .set(...owner.authHeader)
        .send({ to: 'rejected', comment: 'Дорого' })
        .expect(201);
    });

    it('считает сводку по статусам для главного экрана', async () => {
      await createLead();
      const second = await createLead({ contactName: 'Артём' });
      const third = await createLead({ contactName: 'Ольга' });

      await http()
        .post(`/v1/workspaces/${workspaceId}/leads/${second}/transition`)
        .set(...owner.authHeader)
        .send({ to: 'estimated' })
        .expect(201);
      await http()
        .post(`/v1/workspaces/${workspaceId}/leads/${third}/transition`)
        .set(...owner.authHeader)
        .send({ to: 'rejected', comment: 'Передумал' })
        .expect(201);

      const summary = await http()
        .get(`/v1/workspaces/${workspaceId}/leads/summary`)
        .set(...owner.authHeader)
        .expect(200);

      // Отказ в открытые не попадает: он закрыт и на главной не нужен.
      expect(summary.body.total).toBe(2);
      expect(summary.body.byStatus.new).toBe(1);
      expect(summary.body.byStatus.estimated).toBe(1);
      expect(summary.body.rejected).toBe(1);
    });

    it('обращение чужой мастерской недоступно', async () => {
      const leadId = await createLead();
      const otherOwner = await createUser(ctx, { firstName: 'Чужой' });
      const other = await createWorkspace(ctx, { ownerUserId: otherOwner.id, name: 'Чужой цех' });

      await http()
        .get(`/v1/workspaces/${other.id}/leads/${leadId}`)
        .set(...otherOwner.authHeader)
        .expect(404);
    });
  });

  describe('повреждения на схеме кузова', () => {
    it('отмечает деталь и считает несколько повреждений на одной детали', async () => {
      const leadId = await createLead();

      await http()
        .post(`/v1/workspaces/${workspaceId}/leads/${leadId}/damages`)
        .set(...owner.authHeader)
        .send({ panelCode: 'door_fl', damageType: 'door_ding', widthMm: 40, heightMm: 40 })
        .expect(201);
      await http()
        .post(`/v1/workspaces/${workspaceId}/leads/${leadId}/damages`)
        .set(...owner.authHeader)
        .send({ panelCode: 'door_fl', damageType: 'dent', widthMm: 200, heightMm: 200 })
        .expect(201);

      const list = await http()
        .get(`/v1/workspaces/${workspaceId}/leads/${leadId}/damages`)
        .set(...owner.authHeader)
        .expect(200);

      expect(list.body.items).toHaveLength(2);
      // Размерный класс выводится из габаритов, а не из того, что прислали.
      expect(list.body.items[0].sizeClass).toBe('M');
      expect(list.body.items[1].sizeClass).toBe('XL');
    });

    it('не принимает неизвестный элемент кузова', async () => {
      const leadId = await createLead();
      await http()
        .post(`/v1/workspaces/${workspaceId}/leads/${leadId}/damages`)
        .set(...owner.authHeader)
        .send({ panelCode: 'spoiler' })
        .expect(422);
    });

    it('принимает повреждение ровно в том виде, в каком его шлёт форма', async () => {
      // Карточка повреждения на схеме всегда отправляет полный набор полей,
      // включая priceMinor и явные null. Схема обязана принимать то же самое
      // и в отдельном маршруте, и внутри создания обращения.
      const fromForm = {
        panelCode: 'hood',
        damageType: 'hail',
        sizeClass: 'XL',
        widthMm: 400,
        heightMm: 400,
        quantity: 1,
        material: null,
        accessDifficulty: null,
        onEdge: false,
        comment: null,
        priceMinor: null,
      };

      const leadId = await createLead({ damages: [fromForm] });
      await http()
        .post(`/v1/workspaces/${workspaceId}/leads/${leadId}/damages`)
        .set(...owner.authHeader)
        .send(fromForm)
        .expect(201);

      const list = await http()
        .get(`/v1/workspaces/${workspaceId}/leads/${leadId}/damages`)
        .set(...owner.authHeader)
        .expect(200);
      expect(list.body.items).toHaveLength(2);
    });

    it('создаёт повреждения вместе с обращением', async () => {
      const leadId = await createLead({
        damages: [{ panelCode: 'hood', damageType: 'hail', quantity: 12 }],
      });

      const list = await http()
        .get(`/v1/workspaces/${workspaceId}/leads/${leadId}/damages`)
        .set(...owner.authHeader)
        .expect(200);
      expect(list.body.items).toHaveLength(1);
      expect(list.body.items[0].quantity).toBe(12);
    });

    it('удаление повреждения не удаляет снимок, а снимает привязку', async () => {
      const leadId = await createLead();
      const damage = await http()
        .post(`/v1/workspaces/${workspaceId}/leads/${leadId}/damages`)
        .set(...owner.authHeader)
        .send({ panelCode: 'hood' })
        .expect(201);

      const fileId = await uploadPng();
      await http()
        .post(`/v1/workspaces/${workspaceId}/leads/${leadId}/photos`)
        .set(...owner.authHeader)
        .send({ fileId, damageId: damage.body.id })
        .expect(201);

      await http()
        .delete(`/v1/workspaces/${workspaceId}/damages/${damage.body.id}`)
        .set(...owner.authHeader)
        .expect(204);

      const photos = await http()
        .get(`/v1/workspaces/${workspaceId}/leads/${leadId}/photos`)
        .set(...owner.authHeader)
        .expect(200);
      expect(photos.body.items).toHaveLength(1);
      expect(photos.body.items[0].damageId).toBeNull();
    });
  });

  describe('фотографии и разметка', () => {
    it('сохраняет разметку отдельно от оригинала', async () => {
      const leadId = await createLead();
      const fileId = await uploadPng();
      const photo = await http()
        .post(`/v1/workspaces/${workspaceId}/leads/${leadId}/photos`)
        .set(...owner.authHeader)
        .send({ fileId })
        .expect(201);

      const markupFileId = await uploadPng();
      await http()
        .post(`/v1/workspaces/${workspaceId}/photos/${photo.body.id}/markup`)
        .set(...owner.authHeader)
        .send({
          annotation: {
            v: 1,
            shapes: [{ type: 'circle', cx: 0.5, cy: 0.5, rx: 0.2, ry: 0.2 }],
          },
          annotationFileId: markupFileId,
        })
        .expect(201);

      const photos = await http()
        .get(`/v1/workspaces/${workspaceId}/leads/${leadId}/photos`)
        .set(...owner.authHeader)
        .expect(200);

      const saved = photos.body.items[0];
      expect(saved.hasMarkup).toBe(true);
      expect(saved.annotation.shapes).toHaveLength(1);
      // Оригинал — отдельный файл и остаётся прежним.
      expect(saved.fileId).toBe(fileId);
      expect(saved.annotationFileId).toBe(markupFileId);
    });

    it('не даёт подменить оригинал сведённой картинкой', async () => {
      const leadId = await createLead();
      const fileId = await uploadPng();
      const photo = await http()
        .post(`/v1/workspaces/${workspaceId}/leads/${leadId}/photos`)
        .set(...owner.authHeader)
        .send({ fileId })
        .expect(201);

      await http()
        .post(`/v1/workspaces/${workspaceId}/photos/${photo.body.id}/markup`)
        .set(...owner.authHeader)
        .send({ annotation: { v: 1, shapes: [] }, annotationFileId: fileId })
        .expect(422);
    });

    it('снимает разметку, не трогая снимок', async () => {
      const leadId = await createLead();
      const fileId = await uploadPng();
      const photo = await http()
        .post(`/v1/workspaces/${workspaceId}/leads/${leadId}/photos`)
        .set(...owner.authHeader)
        .send({ fileId })
        .expect(201);

      await http()
        .post(`/v1/workspaces/${workspaceId}/photos/${photo.body.id}/markup`)
        .set(...owner.authHeader)
        .send({ annotation: { v: 1, shapes: [{ type: 'arrow', x1: 0, y1: 0, x2: 1, y2: 1 }] } })
        .expect(201);
      await http()
        .post(`/v1/workspaces/${workspaceId}/photos/${photo.body.id}/markup`)
        .set(...owner.authHeader)
        .send({ annotation: null })
        .expect(201);

      const photos = await http()
        .get(`/v1/workspaces/${workspaceId}/leads/${leadId}/photos`)
        .set(...owner.authHeader)
        .expect(200);
      expect(photos.body.items[0].hasMarkup).toBe(false);
      expect(photos.body.items[0].fileId).toBe(fileId);
    });
  });

  describe('оценка', () => {
    it('считает по параметрам повреждения и позволяет переписать итог', async () => {
      await seedPriceList();
      const leadId = await createLead();

      const preview = await http()
        .post(`/v1/workspaces/${workspaceId}/assessments/preview`)
        .set(...owner.authHeader)
        .send({
          items: [{ panelCode: 'door_fl', damageType: 'door_ding', widthMm: 40, heightMm: 40 }],
        })
        .expect(201);
      expect(preview.body.totalMinor).toBe(450000);

      const saved = await http()
        .post(`/v1/workspaces/${workspaceId}/leads/${leadId}/assessments`)
        .set(...owner.authHeader)
        .send({
          method: 'params',
          items: [{ panelCode: 'door_fl', damageType: 'door_ding', widthMm: 40, heightMm: 40 }],
          totalMinor: 400000,
        })
        .expect(201);

      // Предложение расчёта сохраняется рядом с итогом мастера.
      expect(saved.body.suggestedMinor).toBe(450000);
      expect(saved.body.totalMinor).toBe(400000);
      expect(saved.body.overridden).toBe(true);

      // Предварительная оценка попадает в обращение, статус двигается сам.
      const card = await http()
        .get(`/v1/workspaces/${workspaceId}/leads/${leadId}`)
        .set(...owner.authHeader)
        .expect(200);
      expect(card.body.estimateMinor).toBe(400000);
      expect(card.body.status).toBe('estimated');
    });

    it('принимает ручную оценку без позиций', async () => {
      const leadId = await createLead();
      const saved = await http()
        .post(`/v1/workspaces/${workspaceId}/leads/${leadId}/assessments`)
        .set(...owner.authHeader)
        .send({ method: 'manual', totalMinor: 1500000, note: 'Назвал по телефону' })
        .expect(201);

      expect(saved.body.totalMinor).toBe(1500000);
      expect(saved.body.overridden).toBe(true);
      expect(saved.body.items).toHaveLength(0);
    });

    it('переносит цену в повреждение на схеме', async () => {
      await seedPriceList();
      const leadId = await createLead();
      const damage = await http()
        .post(`/v1/workspaces/${workspaceId}/leads/${leadId}/damages`)
        .set(...owner.authHeader)
        .send({ panelCode: 'door_fl', damageType: 'door_ding', widthMm: 40, heightMm: 40 })
        .expect(201);

      await http()
        .post(`/v1/workspaces/${workspaceId}/leads/${leadId}/assessments`)
        .set(...owner.authHeader)
        .send({
          method: 'params',
          items: [
            {
              damageId: damage.body.id,
              panelCode: 'door_fl',
              damageType: 'door_ding',
              widthMm: 40,
              heightMm: 40,
            },
          ],
        })
        .expect(201);

      const list = await http()
        .get(`/v1/workspaces/${workspaceId}/leads/${leadId}/damages`)
        .set(...owner.authHeader)
        .expect(200);
      expect(list.body.items[0].priceMinor).toBe(450000);
      expect(list.body.items[0].priceSource).toBe('params');
    });

    it('правка сохранённой оценки помечает её как исправленную', async () => {
      await seedPriceList();
      const leadId = await createLead();
      const saved = await http()
        .post(`/v1/workspaces/${workspaceId}/leads/${leadId}/assessments`)
        .set(...owner.authHeader)
        .send({
          method: 'params',
          items: [{ panelCode: 'door_fl', damageType: 'door_ding', widthMm: 40, heightMm: 40 }],
        })
        .expect(201);
      expect(saved.body.overridden).toBe(false);

      const updated = await http()
        .patch(`/v1/workspaces/${workspaceId}/assessments/${saved.body.id}`)
        .set(...owner.authHeader)
        .send({ totalMinor: 300000 })
        .expect(200);
      expect(updated.body.totalMinor).toBe(300000);
      expect(updated.body.overridden).toBe(true);
      // Расчёт по прайсу остаётся видимым: понятно, от чего отступили.
      expect(updated.body.suggestedMinor).toBe(450000);
    });

    it('без настроенного провайдера AI-оценка честно отказывает', async () => {
      const leadId = await createLead();
      const fileId = await uploadPng();
      const photo = await http()
        .post(`/v1/workspaces/${workspaceId}/leads/${leadId}/photos`)
        .set(...owner.authHeader)
        .send({ fileId })
        .expect(201);

      const capabilities = await http()
        .get(`/v1/workspaces/${workspaceId}/assessments/capabilities`)
        .set(...owner.authHeader)
        .expect(200);
      const ai = capabilities.body.methods.find((m: { value: string }) => m.value === 'ai');
      expect(ai.available).toBe(false);

      // Отказ — понятный, а не сбой сервера: остальные способы работают.
      const res = await http()
        .post(`/v1/workspaces/${workspaceId}/leads/${leadId}/assessments/analyze`)
        .set(...owner.authHeader)
        .send({ photoIds: [photo.body.id] })
        .expect(503);
      expect(res.body.error.code).toBe('ai_unavailable');
    });
  });

  describe('конверсия в заказ', () => {
    it('переносит клиента, машину, повреждения, фото и оценки', async () => {
      await seedPriceList();
      const leadId = await createLead({ vehiclePlate: 'a123bc77' });

      const damage = await http()
        .post(`/v1/workspaces/${workspaceId}/leads/${leadId}/damages`)
        .set(...owner.authHeader)
        .send({ panelCode: 'door_fl', damageType: 'door_ding', widthMm: 40, heightMm: 40 })
        .expect(201);

      const fileId = await uploadPng();
      await http()
        .post(`/v1/workspaces/${workspaceId}/leads/${leadId}/photos`)
        .set(...owner.authHeader)
        .send({ fileId, damageId: damage.body.id })
        .expect(201);

      await http()
        .post(`/v1/workspaces/${workspaceId}/leads/${leadId}/assessments`)
        .set(...owner.authHeader)
        .send({
          method: 'params',
          items: [
            {
              damageId: damage.body.id,
              panelCode: 'door_fl',
              damageType: 'door_ding',
              widthMm: 40,
              heightMm: 40,
            },
          ],
        })
        .expect(201);

      const converted = await http()
        .post(`/v1/workspaces/${workspaceId}/leads/${leadId}/convert`)
        .set(...owner.authHeader)
        .send({})
        .expect(201);

      expect(converted.body.movedDamages).toBe(1);
      expect(converted.body.movedPhotos).toBe(1);

      // Клиент и автомобиль заводятся из полей обращения, без повторного ввода.
      const order = await http()
        .get(`/v1/workspaces/${workspaceId}/orders/${converted.body.orderId}`)
        .set(...owner.authHeader)
        .expect(200);
      expect(order.body.client.name).toBe('Марина');
      expect(order.body.vehicle.make).toBe('Kia');
      expect(order.body.vehicle.plate).toBe('А123ВС77');
      expect(order.body.damageSummary).toBe('Вмятина на двери');

      // Повреждения и снимки переехали, а не скопировались.
      const orderDamages = await http()
        .get(`/v1/workspaces/${workspaceId}/orders/${converted.body.orderId}/damages`)
        .set(...owner.authHeader)
        .expect(200);
      expect(orderDamages.body.items).toHaveLength(1);
      expect(orderDamages.body.items[0].id).toBe(damage.body.id);

      const leadDamages = await http()
        .get(`/v1/workspaces/${workspaceId}/leads/${leadId}/damages`)
        .set(...owner.authHeader)
        .expect(200);
      expect(leadDamages.body.items).toHaveLength(0);

      const orderPhotos = await http()
        .get(`/v1/workspaces/${workspaceId}/orders/${converted.body.orderId}/photos`)
        .set(...owner.authHeader)
        .expect(200);
      expect(orderPhotos.body.items).toHaveLength(1);

      const orderAssessments = await http()
        .get(`/v1/workspaces/${workspaceId}/orders/${converted.body.orderId}/assessments`)
        .set(...owner.authHeader)
        .expect(200);
      expect(orderAssessments.body.items).toHaveLength(1);
    });

    it('второй заказ по тому же обращению не создаётся', async () => {
      const leadId = await createLead();
      await http()
        .post(`/v1/workspaces/${workspaceId}/leads/${leadId}/convert`)
        .set(...owner.authHeader)
        .send({})
        .expect(201);

      await http()
        .post(`/v1/workspaces/${workspaceId}/leads/${leadId}/convert`)
        .set(...owner.authHeader)
        .send({})
        .expect(409);
    });

    it('обращение с отказом в заказ не превращается', async () => {
      const leadId = await createLead();
      await http()
        .post(`/v1/workspaces/${workspaceId}/leads/${leadId}/transition`)
        .set(...owner.authHeader)
        .send({ to: 'rejected', comment: 'Передумал' })
        .expect(201);

      await http()
        .post(`/v1/workspaces/${workspaceId}/leads/${leadId}/convert`)
        .set(...owner.authHeader)
        .send({})
        .expect(409);
    });
  });

  describe('запись в календарь', () => {
    it('заводит клиента и переводит обращение в «Записан»', async () => {
      const leadId = await createLead();

      const day = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
      const scheduled = await http()
        .post(`/v1/workspaces/${workspaceId}/leads/${leadId}/schedule`)
        .set(...owner.authHeader)
        .send({ startsAtLocal: `${day}T10:00`, durationMin: 60, kind: 'inspection' })
        .expect(201);

      expect(scheduled.body.appointmentId).toBeTruthy();

      const card = await http()
        .get(`/v1/workspaces/${workspaceId}/leads/${leadId}`)
        .set(...owner.authHeader)
        .expect(200);
      expect(card.body.status).toBe('scheduled');
      expect(card.body.contact.clientId).toBe(scheduled.body.clientId);

      // Клиент появился в базе ровно в тот момент, когда стал нужен.
      const clients = await http()
        .get(`/v1/workspaces/${workspaceId}/clients`)
        .set(...owner.authHeader)
        .expect(200);
      expect(clients.body.items).toHaveLength(1);
      expect(clients.body.items[0].name).toBe('Марина');
    });

    it('запись по обращению получает заказ при конверсии', async () => {
      const leadId = await createLead();
      const day = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
      await http()
        .post(`/v1/workspaces/${workspaceId}/leads/${leadId}/schedule`)
        .set(...owner.authHeader)
        .send({ startsAtLocal: `${day}T12:00`, durationMin: 60 })
        .expect(201);

      const converted = await http()
        .post(`/v1/workspaces/${workspaceId}/leads/${leadId}/convert`)
        .set(...owner.authHeader)
        .send({})
        .expect(201);

      const order = await http()
        .get(`/v1/workspaces/${workspaceId}/orders/${converted.body.orderId}`)
        .set(...owner.authHeader)
        .expect(200);
      // Иначе в календаре осталась бы запись без заказа.
      expect(order.body.appointments).toHaveLength(1);
    });
  });

  describe('права', () => {
    it('сотрудник работает с обращениями', async () => {
      await http()
        .post(`/v1/workspaces/${workspaceId}/leads`)
        .set(...employee.authHeader)
        .send({ contactName: 'Пётр', vehicleMake: 'Lada', vehicleModel: 'Vesta' })
        .expect(201);
    });

    it('архивировать обращение может только владелец', async () => {
      const leadId = await createLead();
      // Принятое в проекте правило: недоступный по правам раздел отвечает
      // «не найдено», а не «запрещено» — иначе по коду ответа видно, что есть.
      await http()
        .post(`/v1/workspaces/${workspaceId}/leads/${leadId}/archive`)
        .set(...employee.authHeader)
        .send({ archived: true })
        .expect(404);

      await http()
        .post(`/v1/workspaces/${workspaceId}/leads/${leadId}/archive`)
        .set(...owner.authHeader)
        .send({ archived: true })
        .expect(201);
    });

    it('архивное обращение не правится', async () => {
      const leadId = await createLead();
      await http()
        .post(`/v1/workspaces/${workspaceId}/leads/${leadId}/archive`)
        .set(...owner.authHeader)
        .send({ archived: true })
        .expect(201);

      await http()
        .post(`/v1/workspaces/${workspaceId}/leads/${leadId}/damages`)
        .set(...owner.authHeader)
        .send({ panelCode: 'hood' })
        .expect(422);
    });
  });
});
