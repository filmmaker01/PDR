import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, truncateAll, type TestApp } from './helpers/app';
import { createUser, type TestUser } from './helpers/factories';
import { VideoService } from '@/modules/learning/catalog/video.service';

describe('редактор курса', () => {
  let ctx: TestApp;
  let admin: TestUser;
  const http = () => request(ctx.app.getHttpServer());

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    admin = await createUser(ctx, { platformRoles: ['admin'] });
  });
  afterAll(async () => {
    await ctx.close();
  });

  /** Готовое видео: заглушка провайдера сразу отдаёт ready. */
  async function readyVideo(title = 'Урок'): Promise<string> {
    const created = await http()
      .post('/v1/admin/videos')
      .set(...admin.authHeader)
      .send({ title })
      .expect(201);
    await ctx.app.get(VideoService).markReady(created.body.id, 600);
    return created.body.id;
  }

  async function createCourseWithDraft(): Promise<{ courseId: string; versionId: string }> {
    const course = await http()
      .post('/v1/admin/courses')
      .set(...admin.authHeader)
      .send({ slug: 'pdr-base', title: 'PDR с нуля' })
      .expect(201);
    const versions = await http()
      .get(`/v1/admin/courses/${course.body.id}/versions`)
      .set(...admin.authHeader)
      .expect(200);
    return { courseId: course.body.id, versionId: versions.body[0].id };
  }

  /** Минимальный готовый к публикации курс из одного этапа. */
  async function buildPublishableStage(versionId: string, key = 'stage-1'): Promise<string> {
    const stage = await http()
      .post(`/v1/admin/course-versions/${versionId}/stages`)
      .set(...admin.authHeader)
      .send({ key, title: 'База PDR', unlockDaysOffset: 0 })
      .expect(201);

    await http()
      .post(`/v1/admin/stages/${stage.body.id}/lessons`)
      .set(...admin.authHeader)
      .send({ key: 'light', title: 'Свет и постановка', videoAssetId: await readyVideo() })
      .expect(201);

    return stage.body.id;
  }

  describe('курсы и версии', () => {
    it('создание курса сразу даёт черновик первой версии', async () => {
      const { versionId } = await createCourseWithDraft();
      const version = await http()
        .get(`/v1/admin/course-versions/${versionId}`)
        .set(...admin.authHeader)
        .expect(200);
      expect(version.body.versionNo).toBe(1);
      expect(version.body.status).toBe('draft');
    });

    it('не допускает двух курсов с одним адресом', async () => {
      await createCourseWithDraft();
      await http()
        .post('/v1/admin/courses')
        .set(...admin.authHeader)
        .send({ slug: 'pdr-base', title: 'Другой' })
        .expect(409);
    });

    it('обычный пользователь не имеет доступа к редактору', async () => {
      const plain = await createUser(ctx);
      await http()
        .get('/v1/admin/courses')
        .set(...plain.authHeader)
        .expect(403);
    });
  });

  describe('публикация', () => {
    it('не публикует курс без этапов', async () => {
      const { versionId } = await createCourseWithDraft();
      const res = await http()
        .post(`/v1/admin/course-versions/${versionId}/publish`)
        .set(...admin.authHeader)
        .send({})
        .expect(422);
      expect(res.body.error.code).toBe('publish_validation_failed');
      expect(res.body.error.details[0].message).toMatch(/нет ни одного этапа/);
    });

    it('не публикует обязательный урок без видео', async () => {
      const { versionId } = await createCourseWithDraft();
      const stage = await http()
        .post(`/v1/admin/course-versions/${versionId}/stages`)
        .set(...admin.authHeader)
        .send({ key: 'stage-1', title: 'База' })
        .expect(201);
      await http()
        .post(`/v1/admin/stages/${stage.body.id}/lessons`)
        .set(...admin.authHeader)
        .send({ key: 'intro', title: 'Введение' })
        .expect(201);

      const res = await http()
        .post(`/v1/admin/course-versions/${versionId}/publish`)
        .set(...admin.authHeader)
        .send({})
        .expect(422);
      expect(
        res.body.error.details.some((i: { message: string }) => /без видео/.test(i.message)),
      ).toBe(true);
    });

    it('не публикует тест без правильных ответов', async () => {
      const { versionId } = await createCourseWithDraft();
      const stageId = await buildPublishableStage(versionId);

      const exam = await http()
        .post(`/v1/admin/stages/${stageId}/exams`)
        .set(...admin.authHeader)
        .send({ key: 'test-1', title: 'Тест по базе', kind: 'test', passingScore: 70 })
        .expect(201);

      const noQuestions = await http()
        .post(`/v1/admin/course-versions/${versionId}/publish`)
        .set(...admin.authHeader)
        .send({})
        .expect(422);
      expect(
        noQuestions.body.error.details.some((i: { message: string }) =>
          /нет вопросов/.test(i.message),
        ),
      ).toBe(true);

      await http()
        .post(`/v1/admin/exams/${exam.body.id}/questions`)
        .set(...admin.authHeader)
        .send({
          kind: 'single',
          body: 'Что такое PDR?',
          options: [
            { body: 'Ремонт без покраски', isCorrect: true },
            { body: 'Покраска кузова', isCorrect: false },
          ],
        })
        .expect(201);

      await http()
        .post(`/v1/admin/course-versions/${versionId}/publish`)
        .set(...admin.authHeader)
        .send({ changelog: 'первая версия' })
        .expect(201);
    });

    it('вопрос с одним выбором не принимает два правильных ответа', async () => {
      const { versionId } = await createCourseWithDraft();
      const stageId = await buildPublishableStage(versionId);
      const exam = await http()
        .post(`/v1/admin/stages/${stageId}/exams`)
        .set(...admin.authHeader)
        .send({ key: 'test-1', title: 'Тест', kind: 'test', passingScore: 70 })
        .expect(201);

      await http()
        .post(`/v1/admin/exams/${exam.body.id}/questions`)
        .set(...admin.authHeader)
        .send({
          kind: 'single',
          body: 'Вопрос',
          options: [
            { body: 'А', isCorrect: true },
            { body: 'Б', isCorrect: true },
          ],
        })
        .expect(422);
    });

    it('публикация делает версию неизменяемой и создаёт следующий черновик', async () => {
      const { courseId, versionId } = await createCourseWithDraft();
      const stageId = await buildPublishableStage(versionId);

      await http()
        .post(`/v1/admin/course-versions/${versionId}/publish`)
        .set(...admin.authHeader)
        .send({})
        .expect(201);

      const blocked = await http()
        .patch(`/v1/admin/stages/${stageId}`)
        .set(...admin.authHeader)
        .send({ title: 'Правка после публикации' })
        .expect(409);
      expect(blocked.body.error.code).toBe('version_immutable');

      const versions = await http()
        .get(`/v1/admin/courses/${courseId}/versions`)
        .set(...admin.authHeader)
        .expect(200);
      expect(versions.body).toHaveLength(2);
      expect(versions.body[0]).toMatchObject({ versionNo: 2, status: 'draft' });
      expect(versions.body[1]).toMatchObject({ versionNo: 1, status: 'published' });
    });

    it('новый черновик — полная копия опубликованной версии', async () => {
      const { courseId, versionId } = await createCourseWithDraft();
      const stageId = await buildPublishableStage(versionId);
      const exam = await http()
        .post(`/v1/admin/stages/${stageId}/exams`)
        .set(...admin.authHeader)
        .send({ key: 'test-1', title: 'Тест', kind: 'test', passingScore: 70 })
        .expect(201);
      await http()
        .post(`/v1/admin/exams/${exam.body.id}/questions`)
        .set(...admin.authHeader)
        .send({
          kind: 'multiple',
          body: 'Что относится к PDR?',
          options: [
            { body: 'Град', isCorrect: true },
            { body: 'Вмятина без повреждения ЛКП', isCorrect: true },
            { body: 'Коррозия', isCorrect: false },
          ],
        })
        .expect(201);
      await http()
        .post(`/v1/admin/stages/${stageId}/assignments`)
        .set(...admin.authHeader)
        .send({ key: 'practice-1', title: 'Практика', instructions: 'Снимите фото' })
        .expect(201);

      await http()
        .post(`/v1/admin/course-versions/${versionId}/publish`)
        .set(...admin.authHeader)
        .send({})
        .expect(201);

      const versions = await http()
        .get(`/v1/admin/courses/${courseId}/versions`)
        .set(...admin.authHeader)
        .expect(200);
      const draft = await http()
        .get(`/v1/admin/course-versions/${versions.body[0].id}`)
        .set(...admin.authHeader)
        .expect(200);

      expect(draft.body.stages).toHaveLength(1);
      const stage = draft.body.stages[0];
      expect(stage.key).toBe('stage-1');
      expect(stage.lessons).toHaveLength(1);
      expect(stage.assignments[0].key).toBe('practice-1');
      expect(stage.exams[0].questions[0].options).toHaveLength(3);
      // Черновик — независимые записи, а не ссылки на опубликованные.
      expect(stage.id).not.toBe(stageId);
    });
  });

  describe('структура', () => {
    it('ключи уникальны внутри версии', async () => {
      const { versionId } = await createCourseWithDraft();
      await http()
        .post(`/v1/admin/course-versions/${versionId}/stages`)
        .set(...admin.authHeader)
        .send({ key: 'stage-1', title: 'Первый' })
        .expect(201);
      await http()
        .post(`/v1/admin/course-versions/${versionId}/stages`)
        .set(...admin.authHeader)
        .send({ key: 'stage-1', title: 'Дубль' })
        .expect(409);
    });

    it('отклоняет некорректный ключ', async () => {
      const { versionId } = await createCourseWithDraft();
      await http()
        .post(`/v1/admin/course-versions/${versionId}/stages`)
        .set(...admin.authHeader)
        .send({ key: 'Этап 1', title: 'Первый' })
        .expect(422);
    });

    it('меняет порядок этапов', async () => {
      const { versionId } = await createCourseWithDraft();
      const ids: string[] = [];
      for (const key of ['stage-1', 'stage-2', 'stage-3']) {
        const stage = await http()
          .post(`/v1/admin/course-versions/${versionId}/stages`)
          .set(...admin.authHeader)
          .send({ key, title: key })
          .expect(201);
        ids.push(stage.body.id);
      }

      await http()
        .post(`/v1/admin/course-versions/${versionId}/stages/reorder`)
        .set(...admin.authHeader)
        .send({ order: [ids[2], ids[0], ids[1]] })
        .expect(204);

      const version = await http()
        .get(`/v1/admin/course-versions/${versionId}`)
        .set(...admin.authHeader)
        .expect(200);
      expect(version.body.stages.map((s: { key: string }) => s.key)).toEqual([
        'stage-3',
        'stage-1',
        'stage-2',
      ]);
    });

    it('отклоняет неполный список порядка', async () => {
      const { versionId } = await createCourseWithDraft();
      const stage = await http()
        .post(`/v1/admin/course-versions/${versionId}/stages`)
        .set(...admin.authHeader)
        .send({ key: 'stage-1', title: 'Первый' })
        .expect(201);
      await http()
        .post(`/v1/admin/course-versions/${versionId}/stages`)
        .set(...admin.authHeader)
        .send({ key: 'stage-2', title: 'Второй' })
        .expect(201);

      await http()
        .post(`/v1/admin/course-versions/${versionId}/stages/reorder`)
        .set(...admin.authHeader)
        .send({ order: [stage.body.id] })
        .expect(422);
    });

    it('замена вопроса сохраняет его позицию', async () => {
      const { versionId } = await createCourseWithDraft();
      const stageId = await buildPublishableStage(versionId);
      const exam = await http()
        .post(`/v1/admin/stages/${stageId}/exams`)
        .set(...admin.authHeader)
        .send({ key: 'test-1', title: 'Тест', kind: 'test', passingScore: 70 })
        .expect(201);

      const first = await http()
        .post(`/v1/admin/exams/${exam.body.id}/questions`)
        .set(...admin.authHeader)
        .send({
          kind: 'boolean',
          body: 'Первый',
          options: [
            { body: 'Да', isCorrect: true },
            { body: 'Нет', isCorrect: false },
          ],
        })
        .expect(201);
      await http()
        .post(`/v1/admin/exams/${exam.body.id}/questions`)
        .set(...admin.authHeader)
        .send({
          kind: 'boolean',
          body: 'Второй',
          options: [
            { body: 'Да', isCorrect: true },
            { body: 'Нет', isCorrect: false },
          ],
        })
        .expect(201);

      const replaced = await http()
        .post(`/v1/admin/exams/${exam.body.id}/questions`)
        .set(...admin.authHeader)
        .send({
          questionId: first.body.id,
          kind: 'boolean',
          body: 'Первый, исправленный',
          options: [
            { body: 'Да', isCorrect: false },
            { body: 'Нет', isCorrect: true },
          ],
        })
        .expect(201);

      expect(replaced.body.position).toBe(1);
      const version = await http()
        .get(`/v1/admin/course-versions/${versionId}`)
        .set(...admin.authHeader)
        .expect(200);
      const questions = version.body.stages[0].exams[0].questions;
      expect(questions).toHaveLength(2);
      expect(questions[0].body).toBe('Первый, исправленный');
    });

    it('короткий ответ требует списка принимаемых ответов', async () => {
      const { versionId } = await createCourseWithDraft();
      const stageId = await buildPublishableStage(versionId);
      const exam = await http()
        .post(`/v1/admin/stages/${stageId}/exams`)
        .set(...admin.authHeader)
        .send({ key: 'test-1', title: 'Тест', kind: 'test', passingScore: 70 })
        .expect(201);

      await http()
        .post(`/v1/admin/exams/${exam.body.id}/questions`)
        .set(...admin.authHeader)
        .send({ kind: 'short_text', body: 'Назовите инструмент' })
        .expect(422);

      await http()
        .post(`/v1/admin/exams/${exam.body.id}/questions`)
        .set(...admin.authHeader)
        .send({ kind: 'short_text', body: 'Назовите инструмент', acceptedAnswers: ['крючок'] })
        .expect(201);
    });
  });

  describe('видео', () => {
    it('нельзя удалить видео, использованное в уроке', async () => {
      const { versionId } = await createCourseWithDraft();
      const videoId = await readyVideo('Свет');
      const stage = await http()
        .post(`/v1/admin/course-versions/${versionId}/stages`)
        .set(...admin.authHeader)
        .send({ key: 'stage-1', title: 'База' })
        .expect(201);
      await http()
        .post(`/v1/admin/stages/${stage.body.id}/lessons`)
        .set(...admin.authHeader)
        .send({ key: 'light', title: 'Свет', videoAssetId: videoId })
        .expect(201);

      const res = await http()
        .delete(`/v1/admin/videos/${videoId}`)
        .set(...admin.authHeader)
        .expect(409);
      expect(res.body.error.message).toMatch(/используется/);
    });
  });
});
