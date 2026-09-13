import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, truncateAll, type TestApp } from './helpers/app';
import {
  TEST_BOT_TOKEN,
  createUser,
  makeInitData,
  makeWidgetData,
  nextTelegramId,
} from './helpers/factories';
import { signInitData } from '@/infra/telegram/init-data';

describe('аутентификация', () => {
  let ctx: TestApp;
  const http = () => request(ctx.app.getHttpServer());

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  beforeEach(async () => {
    await truncateAll(ctx.prisma);
  });
  afterAll(async () => {
    await ctx.close();
  });

  describe('вход из Mini App', () => {
    it('создаёт пользователя и выдаёт пару токенов', async () => {
      const telegramId = nextTelegramId();
      const res = await http()
        .post('/v1/auth/telegram/miniapp')
        .send({ initData: makeInitData({ id: telegramId, first_name: 'Иван' }) })
        .expect(200);

      expect(res.body.accessToken).toBeTruthy();
      expect(res.body.refreshToken).toBeTruthy();
      expect(res.body.expiresIn).toBe(900);

      const user = await ctx.prisma.user.findUnique({
        where: { telegramUserId: BigInt(telegramId) },
      });
      expect(user?.firstName).toBe('Иван');
      expect(user?.botWriteAllowed).toBe(true);
    });

    it('повторный вход не создаёт второго пользователя', async () => {
      const telegramId = nextTelegramId();
      await http()
        .post('/v1/auth/telegram/miniapp')
        .send({ initData: makeInitData({ id: telegramId }) })
        .expect(200);
      await http()
        .post('/v1/auth/telegram/miniapp')
        .send({ initData: makeInitData({ id: telegramId, first_name: 'Новое имя' }) })
        .expect(200);

      expect(await ctx.prisma.user.count()).toBe(1);
      const user = await ctx.prisma.user.findFirst();
      expect(user?.firstName).toBe('Новое имя');
    });

    it('возвращает startAction из deep-link', async () => {
      const res = await http()
        .post('/v1/auth/telegram/miniapp')
        .send({ initData: makeInitData({ start_param: 'inv_token123' }) })
        .expect(200);
      expect(res.body.startAction).toBe('inv_token123');
    });

    it('отклоняет подпись другим токеном', async () => {
      const initData = signInitData(
        {
          auth_date: String(Math.floor(Date.now() / 1000)),
          user: JSON.stringify({ id: 777, first_name: 'Злоумышленник' }),
        },
        'wrong:token',
      );
      const res = await http().post('/v1/auth/telegram/miniapp').send({ initData }).expect(401);
      expect(res.body.error.code).toBe('invalid_init_data');
      expect(await ctx.prisma.user.count()).toBe(0);
    });

    it('отклоняет подменённые данные при сохранённом hash', async () => {
      const original = makeInitData({ id: 555 });
      const params = new URLSearchParams(original);
      params.set('user', JSON.stringify({ id: 1, first_name: 'Админ' }));
      await http()
        .post('/v1/auth/telegram/miniapp')
        .send({ initData: params.toString() })
        .expect(401);
    });

    it('отклоняет устаревший auth_date', async () => {
      const stale = makeInitData({ auth_date: Math.floor(Date.now() / 1000) - 3600 });
      const res = await http()
        .post('/v1/auth/telegram/miniapp')
        .send({ initData: stale })
        .expect(401);
      expect(res.body.error.message).toMatch(/устарели/);
    });

    it('не пускает заблокированного пользователя', async () => {
      const telegramId = nextTelegramId();
      await http()
        .post('/v1/auth/telegram/miniapp')
        .send({ initData: makeInitData({ id: telegramId }) })
        .expect(200);
      await ctx.prisma.user.update({
        where: { telegramUserId: BigInt(telegramId) },
        data: { isBanned: true },
      });

      const res = await http()
        .post('/v1/auth/telegram/miniapp')
        .send({ initData: makeInitData({ id: telegramId }) })
        .expect(401);
      expect(res.body.error.code).toBe('user_banned');
    });
  });

  describe('защита маршрутов', () => {
    it('без токена — 401', async () => {
      const res = await http().get('/v1/me').expect(401);
      expect(res.body.error.code).toBe('unauthorized');
    });

    it('с мусорным токеном — 401', async () => {
      await http().get('/v1/me').set('Authorization', 'Bearer not-a-token').expect(401);
    });

    it('с действующим токеном — профиль', async () => {
      const user = await createUser(ctx, { firstName: 'Пётр' });
      const res = await http()
        .get('/v1/me')
        .set(...user.authHeader)
        .expect(200);
      expect(res.body.user.firstName).toBe('Пётр');
      expect(res.body.platformRoles).toEqual([]);
    });

    it('отозванная сессия перестаёт работать сразу', async () => {
      const user = await createUser(ctx);
      await http()
        .get('/v1/me')
        .set(...user.authHeader)
        .expect(200);
      await http()
        .post('/v1/auth/logout')
        .set(...user.authHeader)
        .expect(204);
      const res = await http()
        .get('/v1/me')
        .set(...user.authHeader)
        .expect(401);
      expect(res.body.error.code).toBe('session_revoked');
    });

    it('бан действует на существующие сессии', async () => {
      const user = await createUser(ctx);
      await ctx.prisma.user.update({ where: { id: user.id }, data: { isBanned: true } });
      const res = await http()
        .get('/v1/me')
        .set(...user.authHeader)
        .expect(401);
      expect(res.body.error.code).toBe('user_banned');
    });

    it('logout-all завершает все сессии пользователя', async () => {
      const user = await createUser(ctx);
      const second = await http()
        .post('/v1/auth/telegram/miniapp')
        .send({ initData: makeInitData({ id: user.telegramUserId }) })
        .expect(200);

      await http()
        .post('/v1/auth/logout-all')
        .set(...user.authHeader)
        .expect(200);
      await http()
        .get('/v1/me')
        .set('Authorization', `Bearer ${second.body.accessToken}`)
        .expect(401);
    });
  });

  describe('обновление сессии', () => {
    it('ротирует refresh-токен', async () => {
      const user = await createUser(ctx);
      const res = await http()
        .post('/v1/auth/refresh')
        .send({ refreshToken: user.refreshToken })
        .expect(200);
      expect(res.body.refreshToken).not.toBe(user.refreshToken);
      await http().get('/v1/me').set('Authorization', `Bearer ${res.body.accessToken}`).expect(200);
    });

    it('повторное использование старого токена отзывает все сессии', async () => {
      const user = await createUser(ctx);
      const first = await http()
        .post('/v1/auth/refresh')
        .send({ refreshToken: user.refreshToken })
        .expect(200);

      const reuse = await http()
        .post('/v1/auth/refresh')
        .send({ refreshToken: user.refreshToken })
        .expect(401);
      expect(reuse.body.error.code).toBe('refresh_reused');

      // Даже свежая пара после компрометации больше не действует.
      await http()
        .get('/v1/me')
        .set('Authorization', `Bearer ${first.body.accessToken}`)
        .expect(401);
    });

    it('неизвестный refresh-токен — 401', async () => {
      await http()
        .post('/v1/auth/refresh')
        .send({ refreshToken: 'nope'.repeat(10) })
        .expect(401);
    });
  });

  describe('вход в админку', () => {
    it('Login Widget пускает только пользователей с ролью платформы', async () => {
      const telegramId = nextTelegramId();
      const denied = await http()
        .post('/v1/auth/telegram/widget')
        .send(makeWidgetData({ id: telegramId }))
        .expect(403);
      expect(denied.body.error.code).toBe('platform_role_required');

      const user = await ctx.prisma.user.findUnique({
        where: { telegramUserId: BigInt(telegramId) },
      });
      await ctx.prisma.platformRole.create({ data: { userId: user!.id, role: 'admin' } });

      const ok = await http()
        .post('/v1/auth/telegram/widget')
        .send(makeWidgetData({ id: telegramId }))
        .expect(200);
      expect(ok.body.accessToken).toBeTruthy();
    });

    it('не принимает подпись по алгоритму Mini App', async () => {
      const miniApp = new URLSearchParams(
        signInitData(
          {
            id: '42',
            first_name: 'Админ',
            auth_date: String(Math.floor(Date.now() / 1000)),
          },
          TEST_BOT_TOKEN,
        ),
      );
      await http()
        .post('/v1/auth/telegram/widget')
        .send(Object.fromEntries(miniApp.entries()))
        .expect(401);
    });

    it('вход через бота: запрос → подтверждение → сессия выдаётся один раз', async () => {
      const admin = await createUser(ctx, { platformRoles: ['admin'] });

      const created = await http().post('/v1/auth/web/request').expect(200);
      const code: string = created.body.code;

      const pending = await http().get(`/v1/auth/web/status/${code}`).expect(200);
      expect(pending.body.status).toBe('pending');

      const { AuthService } = await import('@/modules/auth/auth.service');
      await ctx.app.get(AuthService).confirmWebLoginRequest(code, admin.id);

      const confirmed = await http().get(`/v1/auth/web/status/${code}`).expect(200);
      expect(confirmed.body.status).toBe('confirmed');
      expect(confirmed.body.accessToken).toBeTruthy();

      const second = await http().get(`/v1/auth/web/status/${code}`).expect(200);
      expect(second.body.status).toBe('used');
      expect(second.body.accessToken).toBeUndefined();
    });

    it('подтверждение входа недоступно без роли платформы', async () => {
      const user = await createUser(ctx);
      const created = await http().post('/v1/auth/web/request').expect(200);
      const { AuthService } = await import('@/modules/auth/auth.service');
      await expect(
        ctx.app.get(AuthService).confirmWebLoginRequest(created.body.code, user.id),
      ).rejects.toThrow(/панели администратора/);
    });
  });

  describe('профиль', () => {
    it('нормализует телефон', async () => {
      const user = await createUser(ctx);
      const res = await http()
        .patch('/v1/me')
        .set(...user.authHeader)
        .send({ phone: '8 (999) 123-45-67' })
        .expect(200);
      expect(res.body.user.phone).toBe('+79991234567');
    });

    it('отклоняет непохожий на номер ввод', async () => {
      const user = await createUser(ctx);
      const res = await http()
        .patch('/v1/me')
        .set(...user.authHeader)
        .send({ phone: 'нет' })
        .expect(422);
      expect(res.body.error.code).toBe('validation_failed');
    });

    it('отбрасывает неизвестные поля', async () => {
      const user = await createUser(ctx);
      await http()
        .patch('/v1/me')
        .set(...user.authHeader)
        .send({ languageCode: 'en', isBanned: true, id: 'hacked' })
        .expect(200);
      const fresh = await ctx.prisma.user.findUnique({ where: { id: user.id } });
      expect(fresh?.isBanned).toBe(false);
      expect(fresh?.languageCode).toBe('en');
    });
  });

  describe('вебхук Telegram', () => {
    it('отклоняет неверный секрет в пути', async () => {
      await http()
        .post('/v1/telegram/webhook/wrong-secret')
        .set('x-telegram-bot-api-secret-token', 'test-webhook-secret')
        .send({ update_id: 1 })
        .expect(403);
    });

    it('отклоняет неверный заголовок', async () => {
      await http()
        .post('/v1/telegram/webhook/test-webhook-secret')
        .set('x-telegram-bot-api-secret-token', 'wrong')
        .send({ update_id: 2 })
        .expect(403);
    });

    it('обрабатывает обновление один раз', async () => {
      const update = {
        update_id: 4242,
        message: {
          message_id: 1,
          date: Math.floor(Date.now() / 1000),
          chat: { id: 999, type: 'private' },
          from: { id: 999, is_bot: false, first_name: 'Иван' },
          text: '/start',
        },
      };
      for (const _ of [1, 2]) {
        await http()
          .post('/v1/telegram/webhook/test-webhook-secret')
          .set('x-telegram-bot-api-secret-token', 'test-webhook-secret')
          .send(update)
          .expect(200);
      }
      expect(await ctx.prisma.telegramUpdate.count()).toBe(1);
      expect(await ctx.prisma.user.count()).toBe(1);
    });
  });
});
