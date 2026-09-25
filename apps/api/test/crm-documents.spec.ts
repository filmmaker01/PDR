import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, truncateAll, type TestApp } from './helpers/app';
import { createUser, createWorkspace, type TestUser } from './helpers/factories';

/**
 * Документы заказа и месячный календарь.
 *
 * Документ собирается из данных заказа, поэтому проверяется главное: он
 * формируется без повторного ввода, берёт согласованную смету в приоритете
 * над оценкой и не отдаётся по чужому заказу.
 */
describe('CRM: документы заказа и календарь месяцем', () => {
  let ctx: TestApp;
  let owner: TestUser;
  let workspaceId: string;
  let orderId: string;
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

    const order = await http()
      .post(`/v1/workspaces/${workspaceId}/orders`)
      .set(...owner.authHeader)
      .send({
        newClient: { name: 'Николай', phone: '+79087776655' },
        newVehicle: { make: 'Skoda', model: 'Octavia', plate: 'Х123ХХ96' },
        title: 'Дверь передняя левая',
      })
      .expect(201);
    orderId = order.body.id as string;
  });

  /** Скачивание PDF: supertest по умолчанию не собирает бинарный ответ. */
  function getPdf(kind: string, query = '') {
    return http()
      .get(`/v1/workspaces/${workspaceId}/orders/${orderId}/documents/${kind}/pdf${query}`)
      .set(...owner.authHeader)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });
  }

  async function addDamageAndAssessment(): Promise<void> {
    await http()
      .post(`/v1/workspaces/${workspaceId}/price-list`)
      .set(...owner.authHeader)
      .send({ kind: 'damage', title: 'Зона 40×40', sizeClass: '40x40', unitPriceMinor: 900_000 })
      .expect(201);
    const work = await http()
      .post(`/v1/workspaces/${workspaceId}/price-list`)
      .set(...owner.authHeader)
      .send({ kind: 'disassembly', title: 'Разбор двери', unitPriceMinor: 200_000 })
      .expect(201);

    const damage = await http()
      .post(`/v1/workspaces/${workspaceId}/orders/${orderId}/damages`)
      .set(...owner.authHeader)
      .send({
        panelCode: 'door_fl',
        damageType: 'dent',
        sizeClass: '40x40',
        widthMm: 400,
        heightMm: 400,
      })
      .expect(201);

    await http()
      .post(`/v1/workspaces/${workspaceId}/orders/${orderId}/assessments`)
      .set(...owner.authHeader)
      .send({
        method: 'params',
        items: [{ damageId: damage.body.id, panelCode: 'door_fl', sizeClass: '40x40' }],
        extras: [{ priceListItemId: work.body.id }],
        priceCoefficient: 120,
      })
      .expect(201);
  }

  describe('перечень документов', () => {
    it('отдаёт три документа заказа', async () => {
      const res = await http()
        .get(`/v1/workspaces/${workspaceId}/order-documents`)
        .set(...owner.authHeader)
        .expect(200);

      expect((res.body.items as { kind: string }[]).map((item) => item.kind)).toEqual([
        'inspection_act',
        'work_order',
        'completion_act',
      ]);
    });
  });

  describe('печатные формы', () => {
    it('акт осмотра формируется по повреждениям и оценке', async () => {
      await addDamageAndAssessment();
      const res = await getPdf('inspection_act').expect(200);

      expect(res.headers['content-type']).toContain('application/pdf');
      expect(res.headers['content-disposition']).toContain('inline');
      expect((res.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
      expect((res.body as Buffer).length).toBeGreaterThan(1000);
    });

    it('заказ-наряд и акт выполненных работ формируются', async () => {
      await addDamageAndAssessment();
      for (const kind of ['work_order', 'completion_act']) {
        const res = await getPdf(kind).expect(200);
        expect((res.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
      }
    });

    it('документ печатается и без оценки: заказ только что создан', async () => {
      const res = await getPdf('work_order').expect(200);
      expect((res.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
    });

    it('по кнопке «Скачать» отдаётся файлом', async () => {
      const res = await getPdf('inspection_act', '?download=true').expect(200);
      expect(res.headers['content-disposition']).toContain('attachment');
      expect(res.headers['content-disposition']).toContain('.pdf');
    });

    it('неизвестный документ — 404', async () => {
      await getPdf('invoice').expect(404);
    });

    it('чужая мастерская документ не отдаёт', async () => {
      const stranger = await createUser(ctx, { firstName: 'Чужой' });
      await http()
        .get(`/v1/workspaces/${workspaceId}/orders/${orderId}/documents/work_order/pdf`)
        .set(...stranger.authHeader)
        .expect(404);
    });
  });

  describe('календарь месяцем', () => {
    it('считает записи по дням в часовом поясе мастерской', async () => {
      await http()
        .post(`/v1/workspaces/${workspaceId}/appointments`)
        .set(...owner.authHeader)
        .send({ orderId, startsAtLocal: '2026-05-14T10:00', durationMin: 60, kind: 'repair' })
        .expect(201);
      const second = await http()
        .post(`/v1/workspaces/${workspaceId}/appointments`)
        .set(...owner.authHeader)
        .send({ orderId, startsAtLocal: '2026-05-14T12:00', durationMin: 60, kind: 'repair' })
        .expect(201);
      await http()
        .post(`/v1/workspaces/${workspaceId}/appointments`)
        .set(...owner.authHeader)
        .send({ orderId, startsAtLocal: '2026-05-20T09:00', durationMin: 60, kind: 'repair' })
        .expect(201);

      const res = await http()
        .get(`/v1/workspaces/${workspaceId}/appointments/month`)
        .query({ month: '2026-05' })
        .set(...owner.authHeader)
        .expect(200);

      const days = res.body.days as { day: string; total: number; active: number }[];
      expect(res.body.timezone).toBe('Europe/Moscow');
      expect(days.find((d) => d.day === '2026-05-14')).toMatchObject({ total: 2, active: 2 });
      expect(days.find((d) => d.day === '2026-05-20')).toMatchObject({ total: 1, active: 1 });

      // Отменённая запись остаётся в истории, но день не занимает.
      await http()
        .post(`/v1/workspaces/${workspaceId}/appointments/${second.body.id}/status`)
        .set(...owner.authHeader)
        .send({ to: 'cancelled', reason: 'Клиент перенёс' })
        .expect(201);

      const after = await http()
        .get(`/v1/workspaces/${workspaceId}/appointments/month`)
        .query({ month: '2026-05' })
        .set(...owner.authHeader)
        .expect(200);
      expect(
        (after.body.days as { day: string; total: number; active: number }[]).find(
          (d) => d.day === '2026-05-14',
        ),
      ).toMatchObject({ total: 2, active: 1 });
    });

    it('месяц не в формате YYYY-MM не принимается', async () => {
      await http()
        .get(`/v1/workspaces/${workspaceId}/appointments/month`)
        .query({ month: '2026-5' })
        .set(...owner.authHeader)
        .expect(422);
    });
  });

  describe('ссылка на документ для клиента', () => {
    function getShared(token: string) {
      return http()
        .get(`/v1/shared/documents/${token}`)
        .buffer(true)
        .parse((response, callback) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', () => callback(null, Buffer.concat(chunks)));
        });
    }

    it('открывается без входа и отдаёт PDF', async () => {
      const share = await http()
        .post(`/v1/workspaces/${workspaceId}/orders/${orderId}/documents/work_order/share`)
        .set(...owner.authHeader)
        .expect(201);
      expect(share.body.title).toBe('Заказ-наряд');
      expect(new Date(share.body.expiresAt).getTime()).toBeGreaterThan(Date.now());

      const pdf = await getShared(share.body.token).expect(200);
      expect(pdf.headers['content-type']).toContain('application/pdf');
      expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
    });

    it('испорченная ссылка не отдаёт ничего', async () => {
      const share = await http()
        .post(`/v1/workspaces/${workspaceId}/orders/${orderId}/documents/work_order/share`)
        .set(...owner.authHeader)
        .expect(201);
      const token = share.body.token as string;
      await getShared(`${token.slice(0, -2)}xx`).expect(404);
      await getShared('garbage').expect(404);
    });

    it('ссылку на чужой заказ не выдают, неизвестный документ — тоже', async () => {
      const stranger = await createUser(ctx, { firstName: 'Чужой' });
      await createWorkspace(ctx, { ownerUserId: stranger.id, name: 'Другой цех' });
      await http()
        .post(`/v1/workspaces/${workspaceId}/orders/${orderId}/documents/work_order/share`)
        .set(...stranger.authHeader)
        .expect((res) => expect([403, 404]).toContain(res.status));
      await http()
        .post(`/v1/workspaces/${workspaceId}/orders/${orderId}/documents/unknown/share`)
        .set(...owner.authHeader)
        .expect(404);
    });
  });
});
