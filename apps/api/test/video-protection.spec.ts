import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, truncateAll, type TestApp } from './helpers/app';
import {
  createPublishedCourse,
  createUser,
  enrollStudent,
  type TestCourse,
  type TestUser,
} from './helpers/factories';
import { VideoSessionService } from '@/modules/learning/video-access/video-session.service';
import { watermarkCode } from '@/modules/learning/video-access/video-watermark';
import { AppConfigService } from '@/config/config.service';

const DAY = 86_400_000;

/** Всё, что похоже на прямую ссылку на поток. */
const STREAM_PATTERN = /\.(m3u8|mpd|mp4|m4s|ts|webm)(\?|$)|hls|manifest/i;

function findStreamLinks(value: unknown, path = '$'): string[] {
  if (typeof value === 'string') return STREAM_PATTERN.test(value) ? [`${path}: ${value}`] : [];
  if (Array.isArray(value))
    return value.flatMap((item, i) => findStreamLinks(item, `${path}[${i}]`));
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, item]) => findStreamLinks(item, `${path}.${key}`));
  }
  return [];
}

describe('защита видео', () => {
  let ctx: TestApp;
  let admin: TestUser;
  let student: TestUser;
  let other: TestUser;
  let course: TestCourse;
  let enrollmentId: string;
  const http = () => request(ctx.app.getHttpServer());

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    admin = await createUser(ctx, { platformRoles: ['admin'] });
    student = await createUser(ctx, { firstName: 'Ученик' });
    other = await createUser(ctx, { firstName: 'Чужой' });
    course = await createPublishedCourse(ctx, { adminId: admin.id });
    enrollmentId = await enrollStudent(ctx, {
      cohortId: course.cohortId,
      courseId: course.courseId,
      userId: student.id,
      grantedById: admin.id,
    });
  });

  /** Урок первого этапа: он открыт со старта обучения. */
  const OPEN_LESSON = 'light';
  const LOCKED_LESSON = 'hail';

  /** Возвращает цепочку supertest, а не промис: иначе .expect() недоступен. */
  function issueSession(user: TestUser = student, lessonKey = OPEN_LESSON) {
    return http()
      .post(`/v1/learning/enrollments/${enrollmentId}/lessons/${lessonKey}/playback`)
      .set(...user.authHeader)
      .send({ capabilities: { widevine: false, fairplay: false, playready: false } });
  }

  describe('выдача сессии просмотра', () => {
    it('открытый урок выдаёт сессию с адресом плеера и токеном', async () => {
      const res = await issueSession().expect(200);

      expect(res.body.sessionId).toBeTruthy();
      expect(res.body.embedUrl).toBeTruthy();
      expect(res.body.authToken).toBeTruthy();
      expect(new Date(res.body.expiresAt).getTime()).toBeGreaterThan(Date.now());
    });

    it('закрытый этап не выдаёт сессию даже прямым запросом к API', async () => {
      const res = await issueSession(student, LOCKED_LESSON).expect(403);
      expect(res.body.error.code).toBe('stage_locked');

      const sessions = await ctx.prisma.videoViewSession.count();
      expect(sessions).toBe(0);
    });

    it('чужое зачисление не отдаёт сессию и не раскрывает, что оно есть', async () => {
      const res = await issueSession(other).expect(404);
      expect(res.body.error.code).toBe('not_found');
    });

    it('истёкший доступ к курсу не выдаёт сессию', async () => {
      await ctx.prisma.accessGrant.updateMany({
        where: { userId: student.id, product: 'course' },
        data: { validUntil: new Date(Date.now() - DAY), status: 'expired' },
      });

      const res = await issueSession().expect(403);
      expect(res.body.error.code).toBe('product_access_required');
    });

    it('новая сессия закрывает предыдущую: одна активная на урок', async () => {
      const first = await issueSession().expect(200);
      const second = await issueSession().expect(200);
      expect(second.body.sessionId).not.toBe(first.body.sessionId);

      const previous = await ctx.prisma.videoViewSession.findUniqueOrThrow({
        where: { id: first.body.sessionId },
      });
      expect(previous.revokedAt).not.toBeNull();
      expect(previous.revokeReason).toBe('superseded');
    });
  });

  describe('ответы API не содержат ссылок на поток', () => {
    it('ни урок, ни сессия, ни карта курса не отдают hls, mp4 и manifest', async () => {
      const lesson = await http()
        .get(`/v1/learning/enrollments/${enrollmentId}/lessons/${OPEN_LESSON}`)
        .set(...student.authHeader)
        .expect(200);
      const playback = await issueSession().expect(200);
      const map = await http()
        .get(`/v1/learning/enrollments/${enrollmentId}`)
        .set(...student.authHeader)
        .expect(200);

      for (const [name, body] of [
        ['урок', lesson.body],
        ['сессия', playback.body],
        ['карта курса', map.body],
      ] as const) {
        expect(findStreamLinks(body), `${name} содержит ссылку на поток`).toEqual([]);
      }
    });

    it('в ответе урока нет ни адреса плеера, ни токена', async () => {
      const res = await http()
        .get(`/v1/learning/enrollments/${enrollmentId}/lessons/${OPEN_LESSON}`)
        .set(...student.authHeader)
        .expect(200);

      expect(res.body.video).toEqual({ status: 'ready', durationSec: expect.anything() });
      expect(JSON.stringify(res.body)).not.toContain('authToken');
    });
  });

  describe('проверка запросов провайдера', () => {
    it('действующая сессия разрешает воспроизведение и считает обращения', async () => {
      const session = await issueSession().expect(200);

      const res = await http()
        .post('/v1/video/authorize')
        .send({ token: session.body.authToken })
        .expect(200);
      expect(res.body.allowed).toBe(true);

      const stored = await ctx.prisma.videoViewSession.findUniqueOrThrow({
        where: { id: session.body.sessionId },
      });
      expect(stored.checkCount).toBe(1);
      expect(stored.lastCheckAt).not.toBeNull();
    });

    it('отозванная сессия перестаёт работать', async () => {
      const session = await issueSession().expect(200);
      const sessions = ctx.app.get(VideoSessionService);
      await sessions.revokeForUser(student.id, 'manual');

      const res = await http()
        .post('/v1/video/authorize')
        .send({ token: session.body.authToken })
        .expect(403);
      expect(res.body.allowed).toBe(false);
      expect(res.body.reason).toBe('revoked');
    });

    it('истёкшая сессия перестаёт работать', async () => {
      const session = await issueSession().expect(200);
      await ctx.prisma.videoViewSession.update({
        where: { id: session.body.sessionId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const res = await http()
        .post('/v1/video/authorize')
        .send({ token: session.body.authToken })
        .expect(403);
      expect(res.body.reason).toBe('expired');
    });

    it('подделанный токен не проходит', async () => {
      const session = await issueSession().expect(200);
      const [header, claims] = String(session.body.authToken).split('.');

      const res = await http()
        .post('/v1/video/authorize')
        .send({ token: `${header}.${claims}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA` })
        .expect(403);
      expect(res.body.reason).toBe('bad_signature');
    });

    it('сессия одного ученика не работает от имени другого', async () => {
      const session = await issueSession().expect(200);

      // Сессию переписали на чужого пользователя: подпись токена осталась
      // прежней, но владелец больше не совпадает.
      await ctx.prisma.videoViewSession.update({
        where: { id: session.body.sessionId },
        data: { userId: other.id },
      });

      const res = await http()
        .post('/v1/video/authorize')
        .send({ token: session.body.authToken })
        .expect(403);
      expect(res.body.reason).toBe('user_mismatch');
    });

    it('закрытие этапа после выдачи обрывает просмотр', async () => {
      const session = await issueSession().expect(200);

      await ctx.prisma.accessGrant.updateMany({
        where: { userId: student.id, product: 'course' },
        data: { validUntil: new Date(Date.now() - DAY), status: 'expired' },
      });

      const res = await http()
        .post('/v1/video/authorize')
        .send({ token: session.body.authToken })
        .expect(403);
      expect(res.body.reason).toBe('access_lost');

      const stored = await ctx.prisma.videoViewSession.findUniqueOrThrow({
        where: { id: session.body.sessionId },
      });
      expect(stored.revokedAt).not.toBeNull();
    });
  });

  describe('отзыв доступа гасит просмотр', () => {
    it('снятие доступа администратором отзывает активные сессии', async () => {
      const session = await issueSession().expect(200);
      const grant = await ctx.prisma.accessGrant.findFirstOrThrow({
        where: { userId: student.id, product: 'course' },
      });

      await http()
        .post(`/v1/admin/access-grants/${grant.id}/revoke`)
        .set(...admin.authHeader)
        .send({ reason: 'проверка отзыва' })
        .expect(201);

      const stored = await ctx.prisma.videoViewSession.findUniqueOrThrow({
        where: { id: session.body.sessionId },
      });
      expect(stored.revokedAt).not.toBeNull();
      expect(stored.revokeReason).toBe('access_ended');

      await http().post('/v1/video/authorize').send({ token: session.body.authToken }).expect(403);
    });
  });

  describe('водяной знак', () => {
    it('метка принадлежит текущему ученику и не содержит персональных данных', async () => {
      const config = ctx.app.get(AppConfigService);
      const secret = config.env.VIDEO_TOKEN_SECRET || config.env.SESSION_JWT_SECRET;

      const res = await issueSession().expect(200);

      expect(res.body.watermark).toContain(watermarkCode(student.id, secret));
      expect(res.body.watermark).not.toContain(watermarkCode(other.id, secret));
      // Ни имени, ни телефона, ни идентификатора Telegram в метке быть не должно.
      expect(res.body.watermark).not.toContain('Ученик');
      expect(res.body.watermark).not.toContain(String(student.telegramUserId));
    });

    it('метка второго ученика отличается', async () => {
      const otherEnrollment = await enrollStudent(ctx, {
        cohortId: course.cohortId,
        courseId: course.courseId,
        userId: other.id,
        grantedById: admin.id,
      });

      const mine = await issueSession().expect(200);
      const theirs = await http()
        .post(`/v1/learning/enrollments/${otherEnrollment}/lessons/${OPEN_LESSON}/playback`)
        .set(...other.authHeader)
        .send({ capabilities: { widevine: false, fairplay: false, playready: false } })
        .expect(200);

      expect(theirs.body.watermark).not.toBe(mine.body.watermark);
    });
  });

  describe('режим DRM', () => {
    it('без общего флага DRM не выдаётся, даже если клиент его умеет', async () => {
      const res = await http()
        .post(`/v1/learning/enrollments/${enrollmentId}/lessons/${OPEN_LESSON}/playback`)
        .set(...student.authHeader)
        .send({ capabilities: { widevine: true, fairplay: true, playready: true } })
        .expect(200);

      expect(res.body.drm).toBe(false);
    });

    it('решение о режиме принимает сервер по возможностям клиента', () => {
      const sessions = ctx.app.get(VideoSessionService);
      // В тестовом окружении общий флаг выключен, поэтому режим всегда обычный.
      expect(sessions.decideDrm({ widevine: true, fairplay: false, playready: false })).toBe(false);
      expect(sessions.decideDrm({ widevine: false, fairplay: false, playready: false })).toBe(
        false,
      );
    });
  });

  describe('прогресс просмотра', () => {
    it('позиция из событий плеера сохраняется и открывает отметку о прохождении', async () => {
      await issueSession().expect(200);

      // Ровно то, что шлёт плеер в iframe: позиция и процент.
      await http()
        .put(`/v1/learning/enrollments/${enrollmentId}/lessons/${OPEN_LESSON}/progress`)
        .set(...student.authHeader)
        .send({ positionSec: 420, percent: 80 })
        .expect(204);

      const progress = await ctx.prisma.lessonProgress.findFirstOrThrow({
        where: { enrollmentId, lessonKey: OPEN_LESSON },
      });
      expect(progress.watchPercent).toBe(80);
      expect(progress.watchPositionSec).toBe(420);

      await http()
        .post(`/v1/learning/enrollments/${enrollmentId}/lessons/${OPEN_LESSON}/complete`)
        .set(...student.authHeader)
        .expect(201);
    });
  });
});
