import request from 'supertest';
import { rm } from 'node:fs/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { createTestApp, truncateAll, type TestApp } from './helpers/app';
import { addEmployee, createUser, createWorkspace, type TestUser } from './helpers/factories';
import { ExportService } from '@/modules/export/export.service';
import { BackupService } from '@/modules/backup/backup.service';
import { FilesService } from '@/modules/files/files.service';
import { STORAGE_PROVIDER } from '@/infra/storage/storage.module';
import type { StorageProvider } from '@/infra/storage/storage.types';

describe('выгрузки, резервные копии и персональные данные', () => {
  let ctx: TestApp;
  let owner: TestUser;
  let employee: TestUser;
  let admin: TestUser;
  let workspaceId: string;
  const http = () => request(ctx.app.getHttpServer());

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    owner = await createUser(ctx, { firstName: 'Владелец' });
    employee = await createUser(ctx, { firstName: 'Сотрудник' });
    admin = await createUser(ctx, { firstName: 'Админ' });
    await ctx.prisma.platformRole.create({ data: { userId: admin.id, role: 'admin' } });

    const ws = await createWorkspace(ctx, { ownerUserId: owner.id, name: 'Кузовной цех' });
    workspaceId = ws.id;
    await addEmployee(ctx, workspaceId, employee.id);
  });

  afterAll(async () => {
    await ctx.close();
    await rm('./storage-test', { recursive: true, force: true });
  });

  async function seedOrder(): Promise<string> {
    const order = await http()
      .post(`/v1/workspaces/${workspaceId}/orders`)
      .set(...owner.authHeader)
      .send({
        newClient: { name: 'Иван; Петров', phone: '89991234567' },
        newVehicle: { make: 'Toyota', model: 'Camry', plate: 'a123bc77' },
        title: 'Град на капоте',
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
      .send({ items: [{ title: 'Капот', quantity: 1, unitPriceMinor: 500000 }] })
      .expect(200);
    await http()
      .post(`/v1/workspaces/${workspaceId}/estimates/${estimate.body.id}/agree`)
      .set(...owner.authHeader)
      .expect(201);
    await http()
      .post(`/v1/workspaces/${workspaceId}/orders/${order.body.id}/payments`)
      .set(...owner.authHeader)
      .send({ amountMinor: 200000 })
      .expect(201);

    return order.body.id;
  }

  describe('выгрузка CRM', () => {
    it('собирает архив со всеми файлами мастерской', async () => {
      await seedOrder();

      const requested = await http()
        .post(`/v1/workspaces/${workspaceId}/exports`)
        .set(...owner.authHeader)
        .send({ kind: 'crm_full' })
        .expect(201);
      expect(requested.body.status).toBe('queued');

      // Очередь в тестах отключена: выполняем задачу напрямую.
      await ctx.app.get(ExportService).run(requested.body.id);

      const status = await http()
        .get(`/v1/workspaces/${workspaceId}/exports/${requested.body.id}`)
        .set(...owner.authHeader)
        .expect(200);
      expect(status.body.status).toBe('done');
      expect(status.body.ready).toBe(true);

      const record = await ctx.prisma.export.findUniqueOrThrow({
        where: { id: requested.body.id },
      });
      const file = await ctx.app.get(FilesService).getById(record.fileId!);
      const storage = ctx.app.get<StorageProvider>(STORAGE_PROVIDER);
      const zip = await JSZip.loadAsync(await storage.get(file.storageKey));

      expect(Object.keys(zip.files).sort()).toEqual([
        'README.txt',
        'appointments.csv',
        'clients.csv',
        'estimate_items.csv',
        'estimates.csv',
        'orders.csv',
        'payments.csv',
        'vehicles.csv',
      ]);

      const clients = await zip.file('clients.csv')!.async('string');
      // Разделитель внутри значения не должен разорвать строку.
      expect(clients).toContain('"Иван; Петров"');
      expect(clients).toContain('+79991234567');

      const orders = await zip.file('orders.csv')!.async('string');
      expect(orders).toContain('5000,00');
      expect(orders).toContain('2000,00');
    });

    it('отдаёт ссылку на готовую выгрузку и отказывает по неготовой', async () => {
      await seedOrder();
      const requested = await http()
        .post(`/v1/workspaces/${workspaceId}/exports`)
        .set(...owner.authHeader)
        .send({ kind: 'crm_clients' })
        .expect(201);

      await http()
        .get(`/v1/workspaces/${workspaceId}/exports/${requested.body.id}/download`)
        .set(...owner.authHeader)
        .expect(422);

      await ctx.app.get(ExportService).run(requested.body.id);

      const link = await http()
        .get(`/v1/workspaces/${workspaceId}/exports/${requested.body.id}/download`)
        .set(...owner.authHeader)
        .expect(200);
      expect(link.body.url).toContain('http');
      expect(link.body.fileName).toBe('clients.csv');
    });

    it('ставит уведомление о готовности', async () => {
      const requested = await http()
        .post(`/v1/workspaces/${workspaceId}/exports`)
        .set(...owner.authHeader)
        .send({ kind: 'crm_orders' })
        .expect(201);
      await ctx.app.get(ExportService).run(requested.body.id);

      const notification = await ctx.prisma.notification.findFirst({
        where: { userId: owner.id, type: 'export_ready' },
      });
      expect(notification).not.toBeNull();
    });

    it('не даёт заказать вторую выгрузку, пока первая не готова', async () => {
      await http()
        .post(`/v1/workspaces/${workspaceId}/exports`)
        .set(...owner.authHeader)
        .send({ kind: 'crm_orders' })
        .expect(201);

      const second = await http()
        .post(`/v1/workspaces/${workspaceId}/exports`)
        .set(...owner.authHeader)
        .send({ kind: 'crm_clients' })
        .expect(409);
      expect(second.body.error.code).toBe('conflict');
    });

    it('выгрузка закрыта для сотрудника', async () => {
      await http()
        .post(`/v1/workspaces/${workspaceId}/exports`)
        .set(...employee.authHeader)
        .send({ kind: 'crm_full' })
        .expect(404);
    });

    it('работает после окончания доступа к CRM', async () => {
      await ctx.prisma.accessGrant.updateMany({
        where: { workspaceId, product: 'crm' },
        data: { status: 'expired', validUntil: new Date(Date.now() - 86_400_000) },
      });

      await http()
        .post(`/v1/workspaces/${workspaceId}/exports`)
        .set(...owner.authHeader)
        .send({ kind: 'crm_full' })
        .expect(201);
    });

    it('не показывает выгрузки чужой мастерской', async () => {
      const otherOwner = await createUser(ctx, { firstName: 'Чужой' });
      const other = await createWorkspace(ctx, { ownerUserId: otherOwner.id, name: 'Чужая' });
      const foreign = await http()
        .post(`/v1/workspaces/${other.id}/exports`)
        .set(...otherOwner.authHeader)
        .send({ kind: 'crm_full' })
        .expect(201);

      await http()
        .get(`/v1/workspaces/${workspaceId}/exports/${foreign.body.id}`)
        .set(...owner.authHeader)
        .expect(404);
    });

    it('удаляет выгрузки старше срока хранения', async () => {
      const requested = await http()
        .post(`/v1/workspaces/${workspaceId}/exports`)
        .set(...owner.authHeader)
        .send({ kind: 'crm_clients' })
        .expect(201);
      await ctx.app.get(ExportService).run(requested.body.id);

      const removed = await ctx.app
        .get(ExportService)
        .cleanup(new Date(Date.now() + 8 * 86_400_000));
      expect(removed).toBe(1);
      expect(await ctx.prisma.export.count()).toBe(0);
    });
  });

  describe('выгрузки администратора', () => {
    it('администратор выгружает журнал действий', async () => {
      await seedOrder();

      const requested = await http()
        .post('/v1/admin/exports')
        .set(...admin.authHeader)
        .send({ kind: 'audit' })
        .expect(201);
      await ctx.app.get(ExportService).run(requested.body.id);

      const record = await ctx.prisma.export.findUniqueOrThrow({
        where: { id: requested.body.id },
      });
      expect(record.status).toBe('done');
      expect(record.rowCount).toBeGreaterThan(0);
    });

    it('владелец мастерской не может заказать выгрузку администратора', async () => {
      await http()
        .post('/v1/admin/exports')
        .set(...owner.authHeader)
        .send({ kind: 'audit' })
        .expect(403);
    });
  });

  describe('персональные данные', () => {
    it('обезличивание стирает контакты, сохраняя заказы и оплаты', async () => {
      const orderId = await seedOrder();
      const order = await ctx.prisma.order.findUniqueOrThrow({ where: { id: orderId } });

      await http()
        .post(`/v1/workspaces/${workspaceId}/clients/${order.clientId}/anonymize`)
        .set(...owner.authHeader)
        .expect(201);

      const client = await ctx.prisma.client.findUniqueOrThrow({ where: { id: order.clientId } });
      expect(client.phone).toBeNull();
      expect(client.name).not.toContain('Иван');
      expect(client.anonymizedAt).not.toBeNull();

      const vehicle = await ctx.prisma.vehicle.findFirstOrThrow({ where: { workspaceId } });
      expect(vehicle.plate).toBeNull();

      // Финансовые записи остаются.
      expect(await ctx.prisma.order.count({ where: { workspaceId } })).toBe(1);
      expect(await ctx.prisma.paymentEntry.count({ where: { workspaceId } })).toBe(1);
    });

    it('сотрудник не может обезличить клиента', async () => {
      const orderId = await seedOrder();
      const order = await ctx.prisma.order.findUniqueOrThrow({ where: { id: orderId } });

      await http()
        .post(`/v1/workspaces/${workspaceId}/clients/${order.clientId}/anonymize`)
        .set(...employee.authHeader)
        .expect(404);
    });

    it('объединение дублей переносит автомобили и заказы', async () => {
      const orderId = await seedOrder();
      const order = await ctx.prisma.order.findUniqueOrThrow({ where: { id: orderId } });

      const duplicate = await http()
        .post(`/v1/workspaces/${workspaceId}/clients`)
        .set(...owner.authHeader)
        .send({ name: 'Иван Петров', phone: '89990000000', notes: 'второй профиль' })
        .expect(201);

      const result = await http()
        .post(`/v1/workspaces/${workspaceId}/clients/${duplicate.body.id}/merge`)
        .set(...owner.authHeader)
        .send({ sourceClientId: order.clientId })
        .expect(201);

      expect(result.body.movedOrders).toBe(1);
      expect(result.body.movedVehicles).toBe(1);

      const merged = await ctx.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      expect(merged.clientId).toBe(duplicate.body.id);

      const source = await ctx.prisma.client.findUniqueOrThrow({ where: { id: order.clientId } });
      expect(source.archivedAt).not.toBeNull();
    });

    it('клиента нельзя объединить с самим собой', async () => {
      const orderId = await seedOrder();
      const order = await ctx.prisma.order.findUniqueOrThrow({ where: { id: orderId } });

      await http()
        .post(`/v1/workspaces/${workspaceId}/clients/${order.clientId}/merge`)
        .set(...owner.authHeader)
        .send({ sourceClientId: order.clientId })
        .expect(422);
    });
  });

  describe('резервные копии и квоты', () => {
    it('отчёт о копиях считает свежесть', async () => {
      const backups = ctx.app.get(BackupService);

      const empty = await backups.report();
      expect(empty.last).toBeNull();
      expect(empty.stale).toBe(true);

      await backups.record({ label: 'scheduled', objectKey: 'db/2026/05/x.dump', sizeBytes: 4096 });
      const fresh = await backups.report();
      expect(fresh.stale).toBe(false);
      expect(fresh.last?.sizeBytes).toBe(4096);
      expect(fresh.lastWeekCount).toBe(1);
    });

    it('дашборд показывает состояние копий', async () => {
      await ctx.app
        .get(BackupService)
        .record({ label: 'scheduled', objectKey: 'db/x.dump', sizeBytes: 100 });

      const res = await http()
        .get('/v1/admin/dashboard')
        .set(...admin.authHeader)
        .expect(200);
      expect(res.body.backups.stale).toBe(false);
      expect(res.body.backups.last.objectKey).toBe('db/x.dump');
    });

    it('карточка мастерской показывает занятое место', async () => {
      const res = await http()
        .get(`/v1/workspaces/${workspaceId}`)
        .set(...owner.authHeader)
        .expect(200);
      expect(res.body.storage.quotaBytes).toBeGreaterThan(0);
      expect(res.body.storage.usedBytes).toBe(0);
      expect(res.body.storage.warn).toBe(false);
    });

    it('загрузка сверх квоты отклоняется', async () => {
      // Занимаем место записью о большом файле.
      await ctx.prisma.storedFile.create({
        data: {
          ownerUserId: owner.id,
          workspaceId,
          scope: 'order_photo',
          storageKey: 'order_photo/quota/big.jpg',
          bucket: 'test',
          mimeType: 'image/jpeg',
          sizeBytes: BigInt(20_480 * 1024 * 1024),
          status: 'ready',
        },
      });

      const res = await http()
        .post('/v1/files/presign-upload')
        .set(...owner.authHeader)
        .send({ scope: 'order_photo', mimeType: 'image/jpeg', sizeBytes: 1024, workspaceId })
        .expect(422);
      expect(res.body.error.code).toBe('file_too_large');
    });
  });
});
