import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, truncateAll, type TestApp } from './helpers/app';
import { createUser, createWorkspace, type TestUser } from './helpers/factories';

/**
 * Коэффициент стоимости, арматурные работы и размерная сетка.
 *
 * Проверяется именно сервер: базовый расчёт по прайсу, коэффициент поверх
 * него и ручной итог — три раздельные стадии, и ни одну из них интерфейс
 * не должен уметь подменить присланной суммой.
 */
describe('CRM: коэффициент оценки и арматурные работы', () => {
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

  /** Прайс с размерной сеткой: зоны 40×40, 40×60 и 60×60 стоят по-разному. */
  async function seedPriceList(): Promise<void> {
    const rows = [
      { title: 'Вмятина M', sizeClass: 'M', unitPriceMinor: 250_000 },
      { title: 'Зона 40×40', sizeClass: '40x40', unitPriceMinor: 900_000 },
      { title: 'Зона 40×60', sizeClass: '40x60', unitPriceMinor: 1_200_000 },
      { title: 'Зона 60×60', sizeClass: '60x60', unitPriceMinor: 1_500_000 },
    ];
    for (const row of rows) {
      await http()
        .post(`/v1/workspaces/${workspaceId}/price-list`)
        .set(...owner.authHeader)
        .send({ kind: 'damage', ...row })
        .expect(201);
    }
  }

  async function createExtraWork(title: string, priceMinor: number): Promise<string> {
    const res = await http()
      .post(`/v1/workspaces/${workspaceId}/price-list`)
      .set(...owner.authHeader)
      .send({ kind: 'disassembly', title, unitPriceMinor: priceMinor })
      .expect(201);
    return res.body.id as string;
  }

  async function createLead(): Promise<string> {
    const res = await http()
      .post(`/v1/workspaces/${workspaceId}/leads`)
      .set(...owner.authHeader)
      .send({ contactName: 'Николай', contactPhone: '+79087776655' })
      .expect(201);
    return res.body.id as string;
  }

  const doorZone = (sizeClass: string) => ({
    panelCode: 'door_fl',
    damageType: 'dent',
    sizeClass,
    quantity: 1,
  });

  describe('размеры считаются по-настоящему', () => {
    it('40×40, 40×60 и 60×60 дают разную цену', async () => {
      await seedPriceList();

      const prices: number[] = [];
      for (const size of ['40x40', '40x60', '60x60']) {
        const res = await http()
          .post(`/v1/workspaces/${workspaceId}/assessments/preview`)
          .set(...owner.authHeader)
          .send({ items: [doorZone(size)] })
          .expect(201);
        prices.push(res.body.totalMinor);
      }

      expect(prices).toEqual([900_000, 1_200_000, 1_500_000]);
    });

    it('габариты в миллиметрах попадают в класс зоны', async () => {
      await seedPriceList();
      const res = await http()
        .post(`/v1/workspaces/${workspaceId}/assessments/preview`)
        .set(...owner.authHeader)
        .send({
          items: [{ panelCode: 'door_fl', damageType: 'dent', widthMm: 400, heightMm: 600 }],
        })
        .expect(201);

      expect(res.body.lines[0].sizeClass).toBe('40x60');
      expect(res.body.totalMinor).toBe(1_200_000);
    });

    it('неизвестный размерный класс не принимается', async () => {
      await http()
        .post(`/v1/workspaces/${workspaceId}/assessments/preview`)
        .set(...owner.authHeader)
        .send({ items: [doorZone('XXL')] })
        .expect(422);
    });
  });

  describe('коэффициент цены', () => {
    it('применяется поверх базового расчёта и не меняет базу', async () => {
      await seedPriceList();
      const res = await http()
        .post(`/v1/workspaces/${workspaceId}/assessments/preview`)
        .set(...owner.authHeader)
        .send({ items: [doorZone('40x40')], priceCoefficient: 120 })
        .expect(201);

      expect(res.body.baseMinor).toBe(900_000);
      expect(res.body.priceCoefficient).toBe(120);
      expect(res.body.pdrMinor).toBe(1_080_000);
      expect(res.body.totalMinor).toBe(1_080_000);
      expect(res.body.formula).toContain('1.20');
    });

    it('берётся из настроек мастерской, когда его не присылают', async () => {
      await seedPriceList();
      await http()
        .patch(`/v1/workspaces/${workspaceId}`)
        .set(...owner.authHeader)
        .send({ settings: { default_price_coefficient: 150 } })
        .expect(200);

      const res = await http()
        .post(`/v1/workspaces/${workspaceId}/assessments/preview`)
        .set(...owner.authHeader)
        .send({ items: [doorZone('40x40')] })
        .expect(201);

      expect(res.body.priceCoefficient).toBe(150);
      expect(res.body.totalMinor).toBe(1_350_000);
    });

    it('за границы и мимо шага не выходит', async () => {
      await http()
        .post(`/v1/workspaces/${workspaceId}/assessments/preview`)
        .set(...owner.authHeader)
        .send({ items: [doorZone('40x40')], priceCoefficient: 300 })
        .expect(422);

      await http()
        .post(`/v1/workspaces/${workspaceId}/assessments/preview`)
        .set(...owner.authHeader)
        .send({ items: [doorZone('40x40')], priceCoefficient: 123 })
        .expect(422);
    });

    it('сохранённая оценка помнит базу, коэффициент и итог', async () => {
      await seedPriceList();
      const leadId = await createLead();

      const saved = await http()
        .post(`/v1/workspaces/${workspaceId}/leads/${leadId}/assessments`)
        .set(...owner.authHeader)
        .send({ method: 'params', items: [doorZone('40x40')], priceCoefficient: 120 })
        .expect(201);

      expect(saved.body.baseMinor).toBe(900_000);
      expect(saved.body.priceCoefficient).toBe(120);
      expect(saved.body.pdrMinor).toBe(1_080_000);
      expect(saved.body.totalMinor).toBe(1_080_000);
      expect(saved.body.overridden).toBe(false);

      // Предварительная оценка обращения — итог с коэффициентом.
      const lead = await http()
        .get(`/v1/workspaces/${workspaceId}/leads/${leadId}`)
        .set(...owner.authHeader)
        .expect(200);
      expect(lead.body.estimateMinor).toBe(1_080_000);
    });

    it('окончательную цену мастер назначает вручную поверх коэффициента', async () => {
      await seedPriceList();
      const leadId = await createLead();

      const saved = await http()
        .post(`/v1/workspaces/${workspaceId}/leads/${leadId}/assessments`)
        .set(...owner.authHeader)
        .send({
          method: 'params',
          items: [doorZone('40x40')],
          priceCoefficient: 120,
          totalMinor: 1_000_000,
        })
        .expect(201);

      expect(saved.body.baseMinor).toBe(900_000);
      expect(saved.body.pdrMinor).toBe(1_080_000);
      expect(saved.body.totalMinor).toBe(1_000_000);
      expect(saved.body.overridden).toBe(true);
    });

    it('правка одного коэффициента не обнуляет состав оценки', async () => {
      await seedPriceList();
      const leadId = await createLead();

      const saved = await http()
        .post(`/v1/workspaces/${workspaceId}/leads/${leadId}/assessments`)
        .set(...owner.authHeader)
        .send({ method: 'params', items: [doorZone('40x40')] })
        .expect(201);

      const updated = await http()
        .patch(`/v1/workspaces/${workspaceId}/assessments/${saved.body.id}`)
        .set(...owner.authHeader)
        .send({ priceCoefficient: 150 })
        .expect(200);

      expect(updated.body.items).toHaveLength(1);
      expect(updated.body.baseMinor).toBe(900_000);
      expect(updated.body.priceCoefficient).toBe(150);
      expect(updated.body.totalMinor).toBe(1_350_000);
    });
  });

  describe('арматурные работы', () => {
    it('суммируются с PDR, а коэффициент к ним не применяется', async () => {
      await seedPriceList();
      const workId = await createExtraWork('Разбор двери', 200_000);

      const res = await http()
        .post(`/v1/workspaces/${workspaceId}/assessments/preview`)
        .set(...owner.authHeader)
        .send({
          items: [doorZone('40x40')],
          extras: [{ priceListItemId: workId }],
          priceCoefficient: 120,
        })
        .expect(201);

      expect(res.body.pdrMinor).toBe(1_080_000);
      expect(res.body.extrasMinor).toBe(200_000);
      expect(res.body.totalMinor).toBe(1_280_000);
      expect(res.body.extras[0].title).toBe('Разбор двери');
      expect(res.body.formula).toContain('арматурные работы');
    });

    it('цену работы можно переписать вручную', async () => {
      const workId = await createExtraWork('Разбор двери', 200_000);

      const res = await http()
        .post(`/v1/workspaces/${workspaceId}/assessments/preview`)
        .set(...owner.authHeader)
        .send({ extras: [{ priceListItemId: workId, unitPriceMinor: 300_000 }] })
        .expect(201);

      expect(res.body.extras[0].suggestedUnitPriceMinor).toBe(200_000);
      expect(res.body.extras[0].overridden).toBe(true);
      expect(res.body.totalMinor).toBe(300_000);
    });

    it('позиция прайса для повреждений арматурной работой не становится', async () => {
      await seedPriceList();
      const list = await http()
        .get(`/v1/workspaces/${workspaceId}/price-list`)
        .set(...owner.authHeader)
        .expect(200);
      const damageItem = (list.body as { id: string; kind: string }[]).find(
        (item) => item.kind === 'damage',
      )!;

      await http()
        .post(`/v1/workspaces/${workspaceId}/assessments/preview`)
        .set(...owner.authHeader)
        .send({ extras: [{ priceListItemId: damageItem.id, title: 'Своя работа' }] })
        .expect(422);
    });

    it('сохраняются позициями оценки и попадают в итог', async () => {
      await seedPriceList();
      const workId = await createExtraWork('Снятие обшивки двери', 150_000);
      const leadId = await createLead();

      const saved = await http()
        .post(`/v1/workspaces/${workspaceId}/leads/${leadId}/assessments`)
        .set(...owner.authHeader)
        .send({
          method: 'params',
          items: [doorZone('40x40')],
          extras: [{ priceListItemId: workId }],
        })
        .expect(201);

      expect(saved.body.extrasMinor).toBe(150_000);
      expect(saved.body.totalMinor).toBe(1_050_000);
      const extra = (saved.body.items as { kind: string; title: string | null }[]).find(
        (item) => item.kind !== 'damage',
      );
      expect(extra?.title).toBe('Снятие обшивки двери');
    });

    it('своя разовая работа принимается по названию', async () => {
      const res = await http()
        .post(`/v1/workspaces/${workspaceId}/assessments/preview`)
        .set(...owner.authHeader)
        .send({ extras: [{ title: 'Снятие подкрылка', unitPriceMinor: 120_000 }] })
        .expect(201);

      expect(res.body.extras[0].title).toBe('Снятие подкрылка');
      expect(res.body.totalMinor).toBe(120_000);
    });

    it('работа без названия и без позиции справочника не принимается', async () => {
      await http()
        .post(`/v1/workspaces/${workspaceId}/assessments/preview`)
        .set(...owner.authHeader)
        .send({ extras: [{ unitPriceMinor: 100_000 }] })
        .expect(422);
    });

    it('использованная в оценке позиция справочника не удаляется, а скрывается', async () => {
      const workId = await createExtraWork('Разбор двери', 200_000);
      const leadId = await createLead();

      await http()
        .post(`/v1/workspaces/${workspaceId}/leads/${leadId}/assessments`)
        .set(...owner.authHeader)
        .send({ method: 'params', extras: [{ priceListItemId: workId }] })
        .expect(201);

      const removed = await http()
        .delete(`/v1/workspaces/${workspaceId}/price-list/${workId}`)
        .set(...owner.authHeader)
        .expect(200);

      expect(removed.body.deleted).toBe(false);
    });
  });

  describe('новая мастерская', () => {
    it('получает стартовый справочник арматурных работ', async () => {
      const admin = await createUser(ctx, { firstName: 'Админ', platformRoles: ['admin'] });
      const created = await http()
        .post('/v1/admin/workspaces')
        .set(...admin.authHeader)
        .send({ name: 'Новая мастерская', ownerUserId: owner.id })
        .expect(201);

      const list = await http()
        .get(`/v1/workspaces/${created.body.id}/price-list?kind=disassembly`)
        .set(...owner.authHeader)
        .expect(200);

      expect((list.body as unknown[]).length).toBeGreaterThan(0);
      expect((list.body as { title: string }[]).map((item) => item.title)).toContain(
        'Разбор двери',
      );
    });
  });
});
