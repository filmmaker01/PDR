import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, truncateAll, type TestApp } from './helpers/app';
import {
  createPublishedCourse,
  createUser,
  enrollStudent,
  type TestUser,
} from './helpers/factories';
import { ProgressService } from '@/modules/learning/progress/progress.service';
import { StageAccessService } from '@/modules/learning/progress/stage-access.service';

const DAY = 86_400_000;

describe('открытие этапов и прогресс', () => {
  let ctx: TestApp;
  let admin: TestUser;
  let student: TestUser;
  const http = () => request(ctx.app.getHttpServer());

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    admin = await createUser(ctx, { platformRoles: ['admin'] });
    student = await createUser(ctx, { firstName: 'Ученик' });
  });
  afterAll(async () => {
    await ctx.close();
  });

  async function setup(options: { startedDaysAgo?: number } = {}) {
    const course = await createPublishedCourse(ctx, { adminId: admin.id });
    const enrollmentId = await enrollStudent(ctx, {
      cohortId: course.cohortId,
      courseId: course.courseId,
      userId: student.id,
      grantedById: admin.id,
      startedAt: new Date(Date.now() - (options.startedDaysAgo ?? 0) * DAY),
    });
    return { course, enrollmentId };
  }

  describe('правило открытия', () => {
    it('первый этап открыт со старта, следующие закрыты по сроку и по требованиям', async () => {
      const { enrollmentId } = await setup();
      const res = await http()
        .get(`/v1/learning/enrollments/${enrollmentId}`)
        .set(...student.authHeader)
        .expect(200);

      expect(res.body.stages[0].access.status).toBe('open');
      expect(res.body.stages[1].access.status).toBe('locked');

      const codes = res.body.stages[1].access.reasons.map((r: { code: string }) => r.code);
      // Оба условия нарушены — показываем оба, а не первое попавшееся.
      expect(codes).toContain('date');
      expect(codes).toContain('previous_stage');
      expect(res.body.stages[1].access.reasons[0].message).toMatch(/Откроется/);
    });

    it('срок вышел, но предыдущий этап не завершён — этап закрыт', async () => {
      const { enrollmentId } = await setup({ startedDaysAgo: 45 });
      const res = await http()
        .get(`/v1/learning/enrollments/${enrollmentId}`)
        .set(...student.authHeader)
        .expect(200);

      const second = res.body.stages[1];
      expect(second.access.status).toBe('locked');
      const codes = second.access.reasons.map((r: { code: string }) => r.code);
      expect(codes).toEqual(['previous_stage']);
      expect(second.access.reasons[0].message).toMatch(/пройдены не все уроки/);
    });

    it('предыдущий этап завершён, но срок не вышел — этап закрыт', async () => {
      const { enrollmentId } = await setup();
      await ctx.app.get(ProgressService).completeLesson(enrollmentId, 'light');

      const res = await http()
        .get(`/v1/learning/enrollments/${enrollmentId}`)
        .set(...student.authHeader)
        .expect(200);

      expect(res.body.stages[0].access.status).toBe('completed');
      const codes = res.body.stages[1].access.reasons.map((r: { code: string }) => r.code);
      expect(codes).toEqual(['date']);
    });

    it('оба условия выполнены — этап открывается', async () => {
      const { enrollmentId } = await setup({ startedDaysAgo: 45 });
      await ctx.app.get(ProgressService).completeLesson(enrollmentId, 'light');

      const res = await http()
        .get(`/v1/learning/enrollments/${enrollmentId}`)
        .set(...student.authHeader)
        .expect(200);

      expect(res.body.stages[1].access.status).toBe('open');
      expect(res.body.stages[2].access.status).toBe('locked');
    });

    it('режим дат группы работает вместо интервалов', async () => {
      const course = await createPublishedCourse(ctx, {
        adminId: admin.id,
        unlockMode: 'dates',
        cohortStartsAt: new Date(Date.now() - 10 * DAY),
        stageDates: {
          'stage-2': new Date(Date.now() - DAY).toISOString(),
          'stage-3': new Date(Date.now() + 30 * DAY).toISOString(),
        },
      });
      const enrollmentId = await enrollStudent(ctx, {
        cohortId: course.cohortId,
        courseId: course.courseId,
        userId: student.id,
        grantedById: admin.id,
        // Индивидуальный старт сегодня: в режиме дат он не должен влиять.
        startedAt: new Date(),
      });
      await ctx.app.get(ProgressService).completeLesson(enrollmentId, 'light');

      const res = await http()
        .get(`/v1/learning/enrollments/${enrollmentId}`)
        .set(...student.authHeader)
        .expect(200);

      expect(res.body.stages[1].access.status).toBe('open');
      expect(res.body.stages[2].access.status).toBe('locked');
    });
  });

  describe('ручное управление администратором', () => {
    it('открывает этап досрочно с указанием причины', async () => {
      const { enrollmentId } = await setup();

      await http()
        .post(`/v1/admin/enrollments/${enrollmentId}/stage-overrides`)
        .set(...admin.authHeader)
        .send({ stageKey: 'stage-2', action: 'unlock', reason: 'перевод из другой школы' })
        .expect(204);

      const res = await http()
        .get(`/v1/learning/enrollments/${enrollmentId}`)
        .set(...student.authHeader)
        .expect(200);
      expect(res.body.stages[1].access.status).toBe('open');
    });

    it('закрывает открытый этап и показывает причину ученику', async () => {
      const { enrollmentId } = await setup();

      await http()
        .post(`/v1/admin/enrollments/${enrollmentId}/stage-overrides`)
        .set(...admin.authHeader)
        .send({ stageKey: 'stage-1', action: 'lock', reason: 'нарушение правил курса' })
        .expect(204);

      const res = await http()
        .get(`/v1/learning/enrollments/${enrollmentId}`)
        .set(...student.authHeader)
        .expect(200);
      expect(res.body.stages[0].access.status).toBe('locked');
      expect(res.body.stages[0].access.reasons[0].code).toBe('manual_lock');
      expect(res.body.stages[0].access.reasons[0].message).toMatch(/нарушение правил/);
    });

    it('истёкшее временное открытие перестаёт действовать', async () => {
      const { enrollmentId } = await setup();
      await ctx.prisma.stageOverride.create({
        data: {
          enrollmentId,
          stageKey: 'stage-2',
          action: 'unlock',
          reason: 'временный доступ на демонстрацию',
          createdById: admin.id,
          expiresAt: new Date(Date.now() - 1000),
        },
      });

      const access = await ctx.app.get(StageAccessService).getStageAccess(enrollmentId, 'stage-2');
      expect(access.status).toBe('locked');
    });

    it('снятие исключения возвращает обычные правила', async () => {
      const { enrollmentId } = await setup();
      await http()
        .post(`/v1/admin/enrollments/${enrollmentId}/stage-overrides`)
        .set(...admin.authHeader)
        .send({ stageKey: 'stage-2', action: 'unlock', reason: 'тест' })
        .expect(204);

      const card = await http()
        .get(`/v1/admin/enrollments/${enrollmentId}`)
        .set(...admin.authHeader)
        .expect(200);
      const overrideId = card.body.overrides[0].id;

      await http()
        .delete(`/v1/admin/stage-overrides/${overrideId}`)
        .set(...admin.authHeader)
        .expect(204);

      const access = await ctx.app.get(StageAccessService).getStageAccess(enrollmentId, 'stage-2');
      expect(access.status).toBe('locked');
    });

    it('причина обязательна', async () => {
      const { enrollmentId } = await setup();
      await http()
        .post(`/v1/admin/enrollments/${enrollmentId}/stage-overrides`)
        .set(...admin.authHeader)
        .send({ stageKey: 'stage-2', action: 'unlock' })
        .expect(422);
    });
  });

  describe('доступ к содержимому', () => {
    it('урок закрытого этапа недоступен через прямой запрос', async () => {
      const { enrollmentId } = await setup();
      const res = await http()
        .get(`/v1/learning/enrollments/${enrollmentId}/lessons/hail`)
        .set(...student.authHeader)
        .expect(403);
      expect(res.body.error.code).toBe('stage_locked');
      expect(res.body.error.details.reasons).toBeDefined();
    });

    it('этап закрыт — материалы не отдаются, но причины видны', async () => {
      const { enrollmentId } = await setup();
      const res = await http()
        .get(`/v1/learning/enrollments/${enrollmentId}/stages/stage-2`)
        .set(...student.authHeader)
        .expect(200);
      expect(res.body.access.status).toBe('locked');
      expect(res.body.lessons).toEqual([]);
    });

    it('открытый урок сообщает о видео, но не даёт доступа к просмотру', async () => {
      const { enrollmentId } = await setup();
      const res = await http()
        .get(`/v1/learning/enrollments/${enrollmentId}/lessons/light`)
        .set(...student.authHeader)
        .expect(200);
      // Доступ к просмотру выдаётся отдельным запросом и живёт минуты:
      // в описании урока нет ни адреса плеера, ни токена.
      expect(res.body.video.status).toBe('ready');
      expect(res.body.video.embedUrl).toBeUndefined();
    });

    it('чужое зачисление недоступно', async () => {
      const { enrollmentId } = await setup();
      const stranger = await createUser(ctx);
      await http()
        .get(`/v1/learning/enrollments/${enrollmentId}`)
        .set(...stranger.authHeader)
        .expect(404);
      await http()
        .get(`/v1/learning/enrollments/${enrollmentId}/lessons/light`)
        .set(...stranger.authHeader)
        .expect(404);
    });

    it('истёкший доступ к курсу закрывает всё, но сохраняет прогресс', async () => {
      const { enrollmentId } = await setup();
      await ctx.app.get(ProgressService).completeLesson(enrollmentId, 'light');

      await ctx.prisma.accessGrant.updateMany({
        where: { userId: student.id, product: 'course' },
        data: { status: 'revoked', revokedAt: new Date() },
      });

      const map = await http()
        .get(`/v1/learning/enrollments/${enrollmentId}`)
        .set(...student.authHeader)
        .expect(200);
      expect(map.body.access.active).toBe(false);
      expect(map.body.stages[0].access.reasons[0].code).toBe('no_course_access');
      // Прогресс не стёрт.
      expect(map.body.stages[0].progress.lessons.done).toBe(1);

      const lesson = await http()
        .get(`/v1/learning/enrollments/${enrollmentId}/lessons/light`)
        .set(...student.authHeader)
        .expect(403);
      expect(lesson.body.error.code).toBe('product_access_required');
    });
  });

  describe('прогресс урока', () => {
    it('позиция просмотра сохраняется, процент только растёт', async () => {
      const { enrollmentId } = await setup();
      const url = `/v1/learning/enrollments/${enrollmentId}/lessons/light/progress`;

      await http()
        .put(url)
        .set(...student.authHeader)
        .send({ positionSec: 300, percent: 50 })
        .expect(204);
      await http()
        .put(url)
        .set(...student.authHeader)
        .send({ positionSec: 60, percent: 10 })
        .expect(204);

      const progress = await ctx.prisma.lessonProgress.findFirst({ where: { enrollmentId } });
      expect(progress?.watchPositionSec).toBe(60);
      expect(progress?.watchPercent).toBe(50);
    });

    it('порог просмотра не даёт отметить урок раньше времени', async () => {
      const { course, enrollmentId } = await setup();
      const stage = await ctx.prisma.stage.findFirst({
        where: { courseVersionId: course.versionId, key: 'stage-1' },
      });
      await ctx.prisma.lesson.updateMany({
        where: { stageId: stage!.id, key: 'light' },
        data: { minWatchPercent: 80 },
      });

      const res = await http()
        .post(`/v1/learning/enrollments/${enrollmentId}/lessons/light/complete`)
        .set(...student.authHeader)
        .expect(422);
      expect(res.body.error.message).toMatch(/не менее 80%/);

      await http()
        .put(`/v1/learning/enrollments/${enrollmentId}/lessons/light/progress`)
        .set(...student.authHeader)
        .send({ positionSec: 500, percent: 85 })
        .expect(204);

      await http()
        .post(`/v1/learning/enrollments/${enrollmentId}/lessons/light/complete`)
        .set(...student.authHeader)
        .expect(201);
    });

    it('завершение всех этапов закрывает зачисление', async () => {
      const { enrollmentId } = await setup({ startedDaysAgo: 100 });
      const progress = ctx.app.get(ProgressService);
      await progress.completeLesson(enrollmentId, 'light');
      await progress.completeLesson(enrollmentId, 'hail');
      await progress.completeLesson(enrollmentId, 'estimate');

      const enrollment = await ctx.prisma.enrollment.findUnique({ where: { id: enrollmentId } });
      expect(enrollment?.status).toBe('completed');
      expect(enrollment?.completedAt).not.toBeNull();
    });

    it('уведомление об открытии этапа приходит по одному на этап', async () => {
      const { enrollmentId } = await setup({ startedDaysAgo: 45 });
      const progress = ctx.app.get(ProgressService);

      await progress.recalculate(enrollmentId);
      await progress.completeLesson(enrollmentId, 'light');
      await progress.recalculate(enrollmentId);
      await progress.recalculate(enrollmentId);

      const notifications = await ctx.prisma.notification.findMany({
        where: { userId: student.id, type: 'stage_unlocked' },
        orderBy: { createdAt: 'asc' },
      });
      const keys = notifications.map((n) => (n.payload as { stageKey: string }).stageKey);
      expect(keys).toEqual(['stage-1', 'stage-2']);
    });
  });

  describe('зачисление и группы', () => {
    it('зачисление создаёт доступ к курсу одной операцией', async () => {
      const course = await createPublishedCourse(ctx, { adminId: admin.id });
      const res = await http()
        .post(`/v1/admin/cohorts/${course.cohortId}/enrollments`)
        .set(...admin.authHeader)
        .send({ userId: student.id })
        .expect(201);

      expect(res.body.id).toBeTruthy();
      const grants = await ctx.prisma.accessGrant.findMany({
        where: { userId: student.id, product: 'course' },
      });
      expect(grants).toHaveLength(1);
      expect(grants[0]!.courseId).toBe(course.courseId);

      const me = await http()
        .get('/v1/me')
        .set(...student.authHeader)
        .expect(200);
      expect(me.body.enrollments).toHaveLength(1);
      expect(me.body.enrollments[0].hasActiveAccess).toBe(true);
    });

    it('повторное зачисление в ту же группу отклоняется', async () => {
      const course = await createPublishedCourse(ctx, { adminId: admin.id });
      await http()
        .post(`/v1/admin/cohorts/${course.cohortId}/enrollments`)
        .set(...admin.authHeader)
        .send({ userId: student.id })
        .expect(201);
      await http()
        .post(`/v1/admin/cohorts/${course.cohortId}/enrollments`)
        .set(...admin.authHeader)
        .send({ userId: student.id })
        .expect(409);
    });

    it('группу нельзя создать на черновике', async () => {
      const course = await createPublishedCourse(ctx, { adminId: admin.id });
      const draft = await ctx.prisma.courseVersion.findFirst({
        where: { courseId: course.courseId, status: 'draft' },
      });

      await http()
        .post('/v1/admin/cohorts')
        .set(...admin.authHeader)
        .send({
          courseId: course.courseId,
          courseVersionId: draft!.id,
          title: 'Поток 2',
          startsAt: new Date().toISOString(),
        })
        .expect(422);
    });

    it('приостановка обучения закрывает этапы', async () => {
      const { enrollmentId } = await setup();
      await http()
        .patch(`/v1/admin/enrollments/${enrollmentId}`)
        .set(...admin.authHeader)
        .send({ status: 'paused' })
        .expect(200);

      const res = await http()
        .get(`/v1/learning/enrollments/${enrollmentId}`)
        .set(...student.authHeader)
        .expect(200);
      expect(res.body.stages[0].access.reasons[0].code).toBe('enrollment_inactive');
    });

    it('куратором можно назначить только пользователя с ролью куратора', async () => {
      const course = await createPublishedCourse(ctx, { adminId: admin.id });
      const plain = await createUser(ctx);
      await http()
        .post(`/v1/admin/cohorts/${course.cohortId}/curators`)
        .set(...admin.authHeader)
        .send({ userId: plain.id })
        .expect(422);

      const curator = await createUser(ctx, { platformRoles: ['curator'] });
      await http()
        .post(`/v1/admin/cohorts/${course.cohortId}/curators`)
        .set(...admin.authHeader)
        .send({ userId: curator.id })
        .expect(204);
    });
  });

  describe('перенос группы на новую версию', () => {
    it('прогресс по совпадающим ключам сохраняется, новые требования видны в отчёте', async () => {
      const course = await createPublishedCourse(ctx, { adminId: admin.id });
      const enrollmentId = await enrollStudent(ctx, {
        cohortId: course.cohortId,
        courseId: course.courseId,
        userId: student.id,
        grantedById: admin.id,
        startedAt: new Date(Date.now() - 100 * DAY),
      });
      await ctx.app.get(ProgressService).completeLesson(enrollmentId, 'light');

      // Новая версия: тот же этап, но с дополнительным обязательным уроком.
      const v2 = await ctx.prisma.courseVersion.create({
        data: {
          courseId: course.courseId,
          versionNo: 3,
          status: 'published',
          publishedAt: new Date(),
        },
      });
      const stage = await ctx.prisma.stage.create({
        data: {
          courseVersionId: v2.id,
          key: 'stage-1',
          position: 1,
          title: 'База',
          unlockDaysOffset: 0,
        },
      });
      for (const key of ['light', 'new-lesson']) {
        await ctx.prisma.lesson.create({
          data: {
            stageId: stage.id,
            key,
            position: key === 'light' ? 1 : 2,
            title: key,
            isRequired: true,
          },
        });
      }

      const preview = await http()
        .post(`/v1/admin/cohorts/${course.cohortId}/migrate-version`)
        .set(...admin.authHeader)
        .send({ courseVersionId: v2.id, dryRun: true })
        .expect(201);

      expect(preview.body.report.addedRequiredLessons).toContain('stage-1/new-lesson');
      expect(preview.body.report.removedStages).toEqual(
        expect.arrayContaining(['stage-2', 'stage-3']),
      );
      expect(preview.body.report.stagesReopenedFor).toHaveLength(1);

      await http()
        .post(`/v1/admin/cohorts/${course.cohortId}/migrate-version`)
        .set(...admin.authHeader)
        .send({ courseVersionId: v2.id, dryRun: false })
        .expect(201);

      const map = await http()
        .get(`/v1/learning/enrollments/${enrollmentId}`)
        .set(...student.authHeader)
        .expect(200);

      // Отметка по ключу «light» пережила смену версии.
      expect(map.body.stages[0].progress.lessons).toEqual({ done: 1, total: 2 });
      expect(map.body.stages[0].access.status).toBe('open');
    });
  });
});
