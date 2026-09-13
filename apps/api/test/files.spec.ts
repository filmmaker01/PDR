import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { rm } from 'node:fs/promises';
import { createTestApp, truncateAll, type TestApp } from './helpers/app';
import { addEmployee, createUser, createWorkspace, type TestUser } from './helpers/factories';
import { FilesService } from '@/modules/files/files.service';

/** Минимальный валидный PNG 1×1. */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

describe('файлы', () => {
  let ctx: TestApp;
  let owner: TestUser;
  let workspaceId: string;
  const http = () => request(ctx.app.getHttpServer());

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    owner = await createUser(ctx);
    const ws = await createWorkspace(ctx, { ownerUserId: owner.id });
    workspaceId = ws.id;
  });
  afterAll(async () => {
    await ctx.close();
    await rm('./storage-test', { recursive: true, force: true });
  });

  /** Полный путь загрузки: presign → PUT → complete → обработка. */
  async function uploadPng(user: TestUser, body = PNG_1X1): Promise<string> {
    const presigned = await http()
      .post('/v1/files/presign-upload')
      .set(...user.authHeader)
      .send({
        scope: 'order_photo',
        mimeType: 'image/png',
        sizeBytes: body.length,
        workspaceId,
        originalName: 'before.png',
      })
      .expect(201);

    const url = new URL(presigned.body.upload.url);
    await http()
      .post(`${url.pathname}${url.search}`)
      .set('Content-Type', 'application/octet-stream')
      .send(body)
      .expect(201);

    await http()
      .post(`/v1/files/${presigned.body.fileId}/complete`)
      .set(...user.authHeader)
      .send({})
      .expect(201);

    await ctx.app.get(FilesService).process(presigned.body.fileId);
    return presigned.body.fileId;
  }

  describe('загрузка', () => {
    it('проходит полный цикл и создаёт миниатюру', async () => {
      const fileId = await uploadPng(owner);

      const file = await ctx.prisma.storedFile.findUnique({ where: { id: fileId } });
      expect(file?.status).toBe('ready');
      expect(file?.width).toBe(1);
      expect(file?.checksumSha256).toHaveLength(64);
      expect((file?.variants as Record<string, string>).thumb).toMatch(/\.thumb\.webp$/);
    });

    it('выдаёт подписанную ссылку и на оригинал, и на миниатюру', async () => {
      const fileId = await uploadPng(owner);

      const original = await http()
        .get(`/v1/files/${fileId}/url`)
        .set(...owner.authHeader)
        .expect(200);
      expect(original.body.url).toContain('sig=');

      const thumb = await http()
        .get(`/v1/files/${fileId}/url?variant=thumb`)
        .set(...owner.authHeader)
        .expect(200);
      expect(thumb.body.url).toContain('thumb.webp');
    });

    it('отклоняет неподдерживаемый тип', async () => {
      const res = await http()
        .post('/v1/files/presign-upload')
        .set(...owner.authHeader)
        .send({
          scope: 'order_photo',
          mimeType: 'application/x-msdownload',
          sizeBytes: 100,
          workspaceId,
        })
        .expect(422);
      expect(res.body.error.code).toBe('unsupported_file_type');
    });

    it('отклоняет слишком большой файл', async () => {
      const res = await http()
        .post('/v1/files/presign-upload')
        .set(...owner.authHeader)
        .send({
          scope: 'order_photo',
          mimeType: 'image/png',
          sizeBytes: 200 * 1024 * 1024,
          workspaceId,
        })
        .expect(422);
      expect(res.body.error.code).toBe('file_too_large');
    });

    it('отклоняет подтверждение, если размер не совпал', async () => {
      const presigned = await http()
        .post('/v1/files/presign-upload')
        .set(...owner.authHeader)
        .send({ scope: 'order_photo', mimeType: 'image/png', sizeBytes: 999_999, workspaceId })
        .expect(201);

      const url = new URL(presigned.body.upload.url);
      await http().post(`${url.pathname}${url.search}`).send(PNG_1X1).expect(201);

      const res = await http()
        .post(`/v1/files/${presigned.body.fileId}/complete`)
        .set(...owner.authHeader)
        .send({})
        .expect(422);
      expect(res.body.error.message).toMatch(/размер/i);
    });

    it('не принимает файл, содержимое которого не совпадает с типом', async () => {
      const presigned = await http()
        .post('/v1/files/presign-upload')
        .set(...owner.authHeader)
        .send({ scope: 'order_photo', mimeType: 'image/png', sizeBytes: 20, workspaceId })
        .expect(201);

      // Заявлен PNG, а внутри исполняемый файл.
      const fake = Buffer.concat([
        Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]),
        Buffer.alloc(12),
      ]);
      const url = new URL(presigned.body.upload.url);
      await http().post(`${url.pathname}${url.search}`).send(fake).expect(201);
      await http()
        .post(`/v1/files/${presigned.body.fileId}/complete`)
        .set(...owner.authHeader)
        .send({})
        .expect(201);

      await ctx.app.get(FilesService).process(presigned.body.fileId);

      const file = await ctx.prisma.storedFile.findUnique({
        where: { id: presigned.body.fileId },
      });
      expect(file?.status).toBe('failed');
      expect(file?.error).toMatch(/не соответствует/);
    });

    it('повторная ссылка не теряет уже начатую загрузку', async () => {
      const presigned = await http()
        .post('/v1/files/presign-upload')
        .set(...owner.authHeader)
        .send({
          scope: 'order_photo',
          mimeType: 'image/png',
          sizeBytes: PNG_1X1.length,
          workspaceId,
        })
        .expect(201);

      const refreshed = await http()
        .post(`/v1/files/${presigned.body.fileId}/refresh-upload`)
        .set(...owner.authHeader)
        .expect(201);

      expect(refreshed.body.fileId).toBe(presigned.body.fileId);
      expect(refreshed.body.upload.url).not.toBe(presigned.body.upload.url);
    });
  });

  describe('изоляция файлов', () => {
    it('presign на чужую мастерскую отклоняется', async () => {
      const stranger = await createUser(ctx);
      await http()
        .post('/v1/files/presign-upload')
        .set(...stranger.authHeader)
        .send({ scope: 'order_photo', mimeType: 'image/png', sizeBytes: 100, workspaceId })
        .expect(404);
    });

    it('чужой файл недоступен по прямому ID', async () => {
      const fileId = await uploadPng(owner);
      const stranger = await createUser(ctx);

      await http()
        .get(`/v1/files/${fileId}/url`)
        .set(...stranger.authHeader)
        .expect(404);
      await http()
        .get(`/v1/files/${fileId}`)
        .set(...stranger.authHeader)
        .expect(404);
    });

    it('администратор платформы не получает фото заказа', async () => {
      const fileId = await uploadPng(owner);
      const admin = await createUser(ctx, { platformRoles: ['admin'] });
      await http()
        .get(`/v1/files/${fileId}/url`)
        .set(...admin.authHeader)
        .expect(404);
    });

    it('сотрудник мастерской видит её фото, деактивированный — нет', async () => {
      const fileId = await uploadPng(owner);
      const employee = await createUser(ctx);
      const memberId = await addEmployee(ctx, workspaceId, employee.id);

      await http()
        .get(`/v1/files/${fileId}/url`)
        .set(...employee.authHeader)
        .expect(200);

      await ctx.prisma.workspaceMember.update({
        where: { id: memberId },
        data: { isActive: false },
      });
      await http()
        .get(`/v1/files/${fileId}/url`)
        .set(...employee.authHeader)
        .expect(404);
    });

    it('подпись ссылки нельзя подделать', async () => {
      const fileId = await uploadPng(owner);
      const signed = await http()
        .get(`/v1/files/${fileId}/url`)
        .set(...owner.authHeader)
        .expect(200);

      const url = new URL(signed.body.url);
      url.searchParams.set('key', 'order_photo/other/2026/01/secret.png');
      await http().get(`${url.pathname}${url.search}`).expect(403);
    });

    it('истёкшая ссылка не работает', async () => {
      const fileId = await uploadPng(owner);
      const signed = await http()
        .get(`/v1/files/${fileId}/url`)
        .set(...owner.authHeader)
        .expect(200);

      const url = new URL(signed.body.url);
      url.searchParams.set('expires', String(Date.now() - 1000));
      await http().get(`${url.pathname}${url.search}`).expect(403);
    });
  });

  describe('уборка', () => {
    it('удаляет брошенные загрузки старше суток', async () => {
      const presigned = await http()
        .post('/v1/files/presign-upload')
        .set(...owner.authHeader)
        .send({ scope: 'order_photo', mimeType: 'image/png', sizeBytes: 100, workspaceId })
        .expect(201);

      await ctx.prisma.storedFile.update({
        where: { id: presigned.body.fileId },
        data: { createdAt: new Date(Date.now() - 2 * 86_400_000) },
      });

      const result = await ctx.app.get(FilesService).cleanup();
      expect(result.abandoned).toBe(1);
      expect(await ctx.prisma.storedFile.count()).toBe(0);
    });

    it('не трогает недавние незавершённые загрузки', async () => {
      await http()
        .post('/v1/files/presign-upload')
        .set(...owner.authHeader)
        .send({ scope: 'order_photo', mimeType: 'image/png', sizeBytes: 100, workspaceId })
        .expect(201);

      const result = await ctx.app.get(FilesService).cleanup();
      expect(result.abandoned).toBe(0);
      expect(await ctx.prisma.storedFile.count()).toBe(1);
    });

    it('считает объём хранилища мастерской', async () => {
      await uploadPng(owner);
      const used = await ctx.app.get(FilesService).workspaceUsageBytes(workspaceId);
      expect(used).toBe(PNG_1X1.length);
    });
  });
});
