import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';

describe('health', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('GET /health отвечает ok', async () => {
    const res = await request(ctx.app.getHttpServer()).get('/health').expect(200);
    expect(res.body.status).toBe('ok');
  });

  it('GET /health/ready проверяет базу', async () => {
    const res = await request(ctx.app.getHttpServer()).get('/health/ready').expect(200);
    expect(res.body.checks.database.ok).toBe(true);
    expect(res.body.status).toBe('ok');
  });

  it('неизвестный маршрут отвечает единым форматом ошибки', async () => {
    const res = await request(ctx.app.getHttpServer()).get('/v1/nope').expect(404);
    expect(res.body.error.code).toBe('not_found');
    expect(res.body.error.requestId).toBeDefined();
  });
});
