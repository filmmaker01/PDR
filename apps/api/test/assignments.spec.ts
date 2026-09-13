import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, truncateAll, type TestApp } from './helpers/app';
import {
  createPublishedCourse,
  createReadySubmissionFile,
  createUser,
  enrollStudent,
  type TestUser,
} from './helpers/factories';
import { StageAccessService } from '@/modules/learning/progress/stage-access.service';
import { ReviewsService } from '@/modules/learning/assignments/reviews.service';

describe('практика: сдачи и проверки', () => {
  let ctx: TestApp;
  let admin: TestUser;
  let curator: TestUser;
  let student: TestUser;
  let cohortId: string;
  let enrollmentId: string;
  const http = () => request(ctx.app.getHttpServer());

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll(ctx.prisma);
    admin = await createUser(ctx, { platformRoles: ['admin'] });
    curator = await createUser(ctx, { platformRoles: ['curator'], firstName: 'Куратор' });
    student = await createUser(ctx, { firstName: 'Ученик' });

    const course = await createPublishedCourse(ctx, {
      adminId: admin.id,
      stages: [
        {
          key: 'stage-1',
          title: 'База',
          unlockDaysOffset: 0,
          lessons: ['light'],
          assignments: [
            { key: 'practice-1', title: 'Первая вмятина', minPhotos: 2, textRequired: true },
          ],
        },
        { key: 'stage-2', title: 'Сложное', unlockDaysOffset: 0, lessons: ['hail'] },
      ],
    });
    cohortId = course.cohortId;
    enrollmentId = await enrollStudent(ctx, {
      cohortId,
      courseId: course.courseId,
      userId: student.id,
      grantedById: admin.id,
    });
    await ctx.prisma.cohortCurator.create({ data: { cohortId, userId: curator.id } });
  });

  afterAll(async () => {
    await ctx.close();
  });

  /** Черновик с двумя фото и текстом — минимальный комплект по заданию. */
  async function prepareDraft(): Promise<string> {
    const draft = await http()
      .post(`/v1/learning/enrollments/${enrollmentId}/assignments/practice-1/submissions`)
      .set(...student.authHeader)
      .expect(201);
    const submissionId = draft.body.submissionId;

    for (let i = 0; i < 2; i += 1) {
      const fileId = await createReadySubmissionFile(ctx, student.id);
      await http()
        .post(`/v1/learning/submissions/${submissionId}/files`)
        .set(...student.authHeader)
        .send({ fileId })
        .expect(201);
    }
    await http()
      .patch(`/v1/learning/submissions/${submissionId}`)
      .set(...student.authHeader)
      .send({ text: 'Выправил вмятину крючком, сложным был подход снизу.' })
      .expect(200);

    return submissionId;
  }

  describe('отправка работы', () => {
    it('проходит полный путь и появляется в очереди куратора', async () => {
      const submissionId = await prepareDraft();

      await http()
        .post(`/v1/learning/submissions/${submissionId}/submit`)
        .set(...student.authHeader)
        .expect(201);

      const queue = await http()
        .get('/v1/curator/review-queue')
        .set(...curator.authHeader)
        .expect(200);
      expect(queue.body).toHaveLength(1);
      expect(queue.body[0]).toMatchObject({
        assignmentTitle: 'Первая вмятина',
        attemptNo: 1,
        filesCount: 2,
      });
      expect(queue.body[0].student.name).toContain('Ученик');
    });

    it('не отправляет работу без нужного числа фото', async () => {
      const draft = await http()
        .post(`/v1/learning/enrollments/${enrollmentId}/assignments/practice-1/submissions`)
        .set(...student.authHeader)
        .expect(201);
      const fileId = await createReadySubmissionFile(ctx, student.id);
      await http()
        .post(`/v1/learning/submissions/${draft.body.submissionId}/files`)
        .set(...student.authHeader)
        .send({ fileId })
        .expect(201);
      await http()
        .patch(`/v1/learning/submissions/${draft.body.submissionId}`)
        .set(...student.authHeader)
        .send({ text: 'описание' })
        .expect(200);

      const res = await http()
        .post(`/v1/learning/submissions/${draft.body.submissionId}/submit`)
        .set(...student.authHeader)
        .expect(422);
      expect(res.body.error.message).toMatch(/нужно фото: 2/);
    });

    it('не отправляет работу без обязательного описания', async () => {
      const draft = await http()
        .post(`/v1/learning/enrollments/${enrollmentId}/assignments/practice-1/submissions`)
        .set(...student.authHeader)
        .expect(201);
      for (let i = 0; i < 2; i += 1) {
        const fileId = await createReadySubmissionFile(ctx, student.id);
        await http()
          .post(`/v1/learning/submissions/${draft.body.submissionId}/files`)
          .set(...student.authHeader)
          .send({ fileId })
          .expect(201);
      }
      const res = await http()
        .post(`/v1/learning/submissions/${draft.body.submissionId}/submit`)
        .set(...student.authHeader)
        .expect(422);
      expect(res.body.error.message).toMatch(/описание/);
    });

    it('не отправляет работу с необработанными файлами', async () => {
      const draft = await http()
        .post(`/v1/learning/enrollments/${enrollmentId}/assignments/practice-1/submissions`)
        .set(...student.authHeader)
        .expect(201);
      for (let i = 0; i < 2; i += 1) {
        const fileId = await createReadySubmissionFile(ctx, student.id);
        await ctx.prisma.storedFile.update({ where: { id: fileId }, data: { status: 'uploaded' } });
        await http()
          .post(`/v1/learning/submissions/${draft.body.submissionId}/files`)
          .set(...student.authHeader)
          .send({ fileId })
          .expect(201);
      }
      await http()
        .patch(`/v1/learning/submissions/${draft.body.submissionId}`)
        .set(...student.authHeader)
        .send({ text: 'описание' })
        .expect(200);

      const res = await http()
        .post(`/v1/learning/submissions/${draft.body.submissionId}/submit`)
        .set(...student.authHeader)
        .expect(422);
      expect(res.body.error.message).toMatch(/обрабатываются/);
    });

    it('нельзя сдать вторую работу, пока первая на проверке', async () => {
      const submissionId = await prepareDraft();
      await http()
        .post(`/v1/learning/submissions/${submissionId}/submit`)
        .set(...student.authHeader)
        .expect(201);

      const res = await http()
        .post(`/v1/learning/enrollments/${enrollmentId}/assignments/practice-1/submissions`)
        .set(...student.authHeader)
        .expect(409);
      expect(res.body.error.code).toBe('submission_in_progress');
    });

    it('повторная отправка с тем же ключом идемпотентности не создаёт дубль', async () => {
      const submissionId = await prepareDraft();
      const key = '11111111-2222-4333-8444-555555555555';

      const first = await http()
        .post(`/v1/learning/submissions/${submissionId}/submit`)
        .set(...student.authHeader)
        .set('Idempotency-Key', key)
        .expect(201);
      const second = await http()
        .post(`/v1/learning/submissions/${submissionId}/submit`)
        .set(...student.authHeader)
        .set('Idempotency-Key', key)
        .expect(201);

      expect(second.body).toEqual(first.body);
      expect(await ctx.prisma.submission.count()).toBe(1);
    });

    it('нельзя приложить чужой файл', async () => {
      const draft = await http()
        .post(`/v1/learning/enrollments/${enrollmentId}/assignments/practice-1/submissions`)
        .set(...student.authHeader)
        .expect(201);
      const stranger = await createUser(ctx);
      const foreignFile = await createReadySubmissionFile(ctx, stranger.id);

      await http()
        .post(`/v1/learning/submissions/${draft.body.submissionId}/files`)
        .set(...student.authHeader)
        .send({ fileId: foreignFile })
        .expect(404);
    });

    it('задание закрытого этапа недоступно', async () => {
      const course = await createPublishedCourse(ctx, {
        adminId: admin.id,
        stages: [
          { key: 'stage-1', title: 'База', unlockDaysOffset: 0, lessons: ['light'] },
          {
            key: 'stage-2',
            title: 'Сложное',
            unlockDaysOffset: 30,
            lessons: ['hail'],
            assignments: [{ key: 'practice-2', title: 'Град' }],
          },
        ],
      });
      const другоеЗачисление = await enrollStudent(ctx, {
        cohortId: course.cohortId,
        courseId: course.courseId,
        userId: student.id,
        grantedById: admin.id,
      });

      const res = await http()
        .post(`/v1/learning/enrollments/${другоеЗачисление}/assignments/practice-2/submissions`)
        .set(...student.authHeader)
        .expect(403);
      expect(res.body.error.code).toBe('stage_locked');
    });
  });

  describe('проверка куратором', () => {
    async function submitted(): Promise<string> {
      const submissionId = await prepareDraft();
      await http()
        .post(`/v1/learning/submissions/${submissionId}/submit`)
        .set(...student.authHeader)
        .expect(201);
      return submissionId;
    }

    it('возврат на доработку позволяет сдать заново', async () => {
      const submissionId = await submitted();

      await http()
        .post(`/v1/curator/submissions/${submissionId}/claim`)
        .set(...curator.authHeader)
        .expect(204);
      await http()
        .post(`/v1/curator/submissions/${submissionId}/review`)
        .set(...curator.authHeader)
        .send({ decision: 'returned', comment: 'Свет поставлен неверно, переснимите «до».' })
        .expect(204);

      const assignment = await http()
        .get(`/v1/learning/enrollments/${enrollmentId}/assignments/practice-1`)
        .set(...student.authHeader)
        .expect(200);
      expect(assignment.body.attempts[0].status).toBe('returned');
      expect(assignment.body.attempts[0].review.comment).toMatch(/Свет поставлен/);
      expect(assignment.body.accepted).toBe(false);

      const second = await http()
        .post(`/v1/learning/enrollments/${enrollmentId}/assignments/practice-1/submissions`)
        .set(...student.authHeader)
        .expect(201);
      expect(second.body.attemptNo).toBe(2);
    });

    it('принятая работа засчитывает требование этапа', async () => {
      const submissionId = await submitted();
      await http()
        .post(`/v1/curator/submissions/${submissionId}/review`)
        .set(...curator.authHeader)
        .send({ decision: 'accepted', comment: 'Хорошо, форма восстановлена.' })
        .expect(204);

      const states = await ctx.app.get(StageAccessService).getStageStates(enrollmentId);
      expect(states[0]!.progress.assignments).toEqual({ done: 1, total: 1 });

      const map = await http()
        .get(`/v1/learning/enrollments/${enrollmentId}`)
        .set(...student.authHeader)
        .expect(200);
      // Уроки ещё не пройдены, поэтому этап не завершён — но практика засчитана.
      expect(map.body.stages[0].progress.assignments.done).toBe(1);
      expect(map.body.stages[1].access.status).toBe('locked');
    });

    it('этап завершается, когда приняты и уроки, и практика', async () => {
      const submissionId = await submitted();
      await http()
        .post(`/v1/curator/submissions/${submissionId}/review`)
        .set(...curator.authHeader)
        .send({ decision: 'accepted', comment: 'Принято' })
        .expect(204);
      await http()
        .post(`/v1/learning/enrollments/${enrollmentId}/lessons/light/complete`)
        .set(...student.authHeader)
        .expect(201);

      const map = await http()
        .get(`/v1/learning/enrollments/${enrollmentId}`)
        .set(...student.authHeader)
        .expect(200);
      expect(map.body.stages[0].access.status).toBe('completed');
      expect(map.body.stages[1].access.status).toBe('open');
    });

    it('ученик получает уведомление о решении', async () => {
      const submissionId = await submitted();
      await http()
        .post(`/v1/curator/submissions/${submissionId}/review`)
        .set(...curator.authHeader)
        .send({ decision: 'returned', comment: 'Нужно переснять' })
        .expect(204);

      const notification = await ctx.prisma.notification.findFirst({
        where: { userId: student.id, type: 'review_result' },
      });
      expect(notification).not.toBeNull();
      expect((notification!.payload as { decision: string }).decision).toBe('returned');
    });

    it('комментарий обязателен', async () => {
      const submissionId = await submitted();
      await http()
        .post(`/v1/curator/submissions/${submissionId}/review`)
        .set(...curator.authHeader)
        .send({ decision: 'accepted' })
        .expect(422);
    });

    it('повторное решение по проверенной работе отклоняется', async () => {
      const submissionId = await submitted();
      await http()
        .post(`/v1/curator/submissions/${submissionId}/review`)
        .set(...curator.authHeader)
        .send({ decision: 'accepted', comment: 'Принято' })
        .expect(204);
      await http()
        .post(`/v1/curator/submissions/${submissionId}/review`)
        .set(...curator.authHeader)
        .send({ decision: 'returned', comment: 'Передумал' })
        .expect(409);
    });

    it('второй куратор не может взять работу, пока удержание не истекло', async () => {
      const submissionId = await submitted();
      const other = await createUser(ctx, { platformRoles: ['curator'] });
      await ctx.prisma.cohortCurator.create({ data: { cohortId, userId: other.id } });

      await http()
        .post(`/v1/curator/submissions/${submissionId}/claim`)
        .set(...curator.authHeader)
        .expect(204);
      await http()
        .post(`/v1/curator/submissions/${submissionId}/claim`)
        .set(...other.authHeader)
        .expect(409);

      // Истёкшее удержание возвращает работу в общую очередь.
      await ctx.prisma.submission.update({
        where: { id: submissionId },
        data: { claimedAt: new Date(Date.now() - 40 * 60_000) },
      });
      await http()
        .post(`/v1/curator/submissions/${submissionId}/claim`)
        .set(...other.authHeader)
        .expect(204);
    });

    it('фоновая задача снимает зависшие удержания', async () => {
      const submissionId = await submitted();
      await http()
        .post(`/v1/curator/submissions/${submissionId}/claim`)
        .set(...curator.authHeader)
        .expect(204);
      await ctx.prisma.submission.update({
        where: { id: submissionId },
        data: { claimedAt: new Date(Date.now() - 60 * 60_000) },
      });

      const released = await ctx.app.get(ReviewsService).releaseStaleClaims();
      expect(released).toBe(1);

      const submission = await ctx.prisma.submission.findUnique({ where: { id: submissionId } });
      expect(submission?.status).toBe('submitted');
      expect(submission?.claimedById).toBeNull();
    });
  });

  describe('права на проверку', () => {
    it('куратор чужой группы не видит работу', async () => {
      const submissionId = await prepareDraft();
      await http()
        .post(`/v1/learning/submissions/${submissionId}/submit`)
        .set(...student.authHeader)
        .expect(201);

      const foreignCurator = await createUser(ctx, { platformRoles: ['curator'] });
      const queue = await http()
        .get('/v1/curator/review-queue')
        .set(...foreignCurator.authHeader)
        .expect(200);
      expect(queue.body).toHaveLength(0);

      await http()
        .get(`/v1/curator/submissions/${submissionId}`)
        .set(...foreignCurator.authHeader)
        .expect(404);
      await http()
        .post(`/v1/curator/submissions/${submissionId}/review`)
        .set(...foreignCurator.authHeader)
        .send({ decision: 'accepted', comment: 'Принято' })
        .expect(404);
    });

    it('администратор видит работы всех групп', async () => {
      const submissionId = await prepareDraft();
      await http()
        .post(`/v1/learning/submissions/${submissionId}/submit`)
        .set(...student.authHeader)
        .expect(201);

      const queue = await http()
        .get('/v1/curator/review-queue')
        .set(...admin.authHeader)
        .expect(200);
      expect(queue.body).toHaveLength(1);
    });

    it('ученик не имеет доступа к разделу проверок', async () => {
      await http()
        .get('/v1/curator/review-queue')
        .set(...student.authHeader)
        .expect(403);
    });

    it('чужая работа недоступна ученику', async () => {
      const submissionId = await prepareDraft();
      const stranger = await createUser(ctx);
      await http()
        .get(`/v1/learning/submissions/${submissionId}`)
        .set(...stranger.authHeader)
        .expect(404);
    });
  });

  describe('переписка по работе', () => {
    it('куратор и ученик обмениваются комментариями', async () => {
      const submissionId = await prepareDraft();
      await http()
        .post(`/v1/learning/submissions/${submissionId}/submit`)
        .set(...student.authHeader)
        .expect(201);

      await http()
        .post(`/v1/curator/submissions/${submissionId}/comments`)
        .set(...curator.authHeader)
        .send({ body: 'С какого расстояния снимали «до»?' })
        .expect(204);
      await http()
        .post(`/v1/learning/submissions/${submissionId}/comments`)
        .set(...student.authHeader)
        .send({ body: 'Примерно метр.' })
        .expect(201);

      const submission = await http()
        .get(`/v1/learning/submissions/${submissionId}`)
        .set(...student.authHeader)
        .expect(200);
      expect(submission.body.comments).toHaveLength(2);
      expect(submission.body.comments[1].isMine).toBe(true);

      // Комментарий не меняет статус: решение остаётся за куратором.
      expect(submission.body.status).toBe('submitted');
    });
  });

  describe('доступ к файлам работ', () => {
    it('куратор своей группы видит файл, чужой — нет', async () => {
      const submissionId = await prepareDraft();
      await http()
        .post(`/v1/learning/submissions/${submissionId}/submit`)
        .set(...student.authHeader)
        .expect(201);

      const fileLink = await ctx.prisma.submissionFile.findFirst({ where: { submissionId } });
      const fileId = fileLink!.fileId;

      await http()
        .get(`/v1/files/${fileId}/url`)
        .set(...curator.authHeader)
        .expect(200);
      await http()
        .get(`/v1/files/${fileId}/url`)
        .set(...student.authHeader)
        .expect(200);
      await http()
        .get(`/v1/files/${fileId}/url`)
        .set(...admin.authHeader)
        .expect(200);

      const foreignCurator = await createUser(ctx, { platformRoles: ['curator'] });
      await http()
        .get(`/v1/files/${fileId}/url`)
        .set(...foreignCurator.authHeader)
        .expect(404);

      const stranger = await createUser(ctx);
      await http()
        .get(`/v1/files/${fileId}/url`)
        .set(...stranger.authHeader)
        .expect(404);
    });
  });
});
