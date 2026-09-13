import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, truncateAll, type TestApp } from './helpers/app';
import {
  createPublishedCourse,
  createReadyAttemptFile,
  createUser,
  enrollStudent,
  type TestUser,
} from './helpers/factories';
import { ExamsService } from '@/modules/learning/exams/exams.service';

describe('тесты и экзамены', () => {
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
    curator = await createUser(ctx, { platformRoles: ['curator'] });
    student = await createUser(ctx, { firstName: 'Ученик' });

    const course = await createPublishedCourse(ctx, {
      adminId: admin.id,
      stages: [
        {
          key: 'stage-1',
          title: 'База',
          unlockDaysOffset: 0,
          lessons: ['light'],
          exams: [
            {
              key: 'test-1',
              title: 'Тест по базе',
              kind: 'test',
              passingScore: 70,
              maxAttempts: 3,
              cooldownHours: 0,
              questions: [
                {
                  body: 'Что показывает полоса света?',
                  options: [
                    ['Искажение отражения', true],
                    ['Толщину покрытия', false],
                  ],
                },
                {
                  body: 'Что относится к PDR?',
                  kind: 'multiple',
                  points: 2,
                  options: [
                    ['Град', true],
                    ['Вмятина без повреждения ЛКП', true],
                    ['Коррозия', false],
                  ],
                },
                {
                  body: 'Назовите основной инструмент',
                  kind: 'short_text',
                  acceptedAnswers: ['крючок'],
                },
              ],
            },
            {
              key: 'final',
              title: 'Практический экзамен',
              kind: 'practical',
              passingScore: 60,
            },
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

  async function startTest(): Promise<{
    attemptId: string;
    questions: { id: string; kind: string; options: { id: string; body: string }[] }[];
  }> {
    const res = await http()
      .post(`/v1/learning/enrollments/${enrollmentId}/exams/test-1/attempts`)
      .set(...student.authHeader)
      .expect(201);
    return { attemptId: res.body.id, questions: res.body.questions };
  }

  async function answerAll(
    attemptId: string,
    questions: { id: string; kind: string; options: { id: string; body: string }[] }[],
    correct: boolean,
  ): Promise<void> {
    for (const question of questions) {
      if (question.kind === 'short_text') {
        await http()
          .put(`/v1/learning/attempts/${attemptId}/answers/${question.id}`)
          .set(...student.authHeader)
          .send({ textAnswer: correct ? 'Крючок' : 'молоток' })
          .expect(204);
        continue;
      }
      const correctIds =
        question.kind === 'multiple'
          ? question.options.slice(0, 2).map((o) => o.id)
          : [question.options[0]!.id];
      const wrongIds = [question.options.at(-1)!.id];
      await http()
        .put(`/v1/learning/attempts/${attemptId}/answers/${question.id}`)
        .set(...student.authHeader)
        .send({ selectedOptionIds: correct ? correctIds : wrongIds })
        .expect(204);
    }
  }

  describe('тест с автопроверкой', () => {
    it('правильные ответы дают 100% и сдачу', async () => {
      const { attemptId, questions } = await startTest();
      await answerAll(attemptId, questions, true);

      const result = await http()
        .post(`/v1/learning/attempts/${attemptId}/submit`)
        .set(...student.authHeader)
        .expect(201);

      expect(result.body.percent).toBe(100);
      expect(result.body.passed).toBe(true);
      expect(result.body.status).toBe('graded');
    });

    it('неверные ответы не проходят порог', async () => {
      const { attemptId, questions } = await startTest();
      await answerAll(attemptId, questions, false);

      const result = await http()
        .post(`/v1/learning/attempts/${attemptId}/submit`)
        .set(...student.authHeader)
        .expect(201);
      expect(result.body.passed).toBe(false);
      expect(result.body.percent).toBe(0);
    });

    it('правильные ответы не раскрываются до завершения', async () => {
      const { attemptId, questions } = await startTest();
      expect(questions[0]!.options.every((o) => !('isCorrect' in o))).toBe(true);

      const inProgress = await http()
        .get(`/v1/learning/attempts/${attemptId}`)
        .set(...student.authHeader)
        .expect(200);
      expect(JSON.stringify(inProgress.body)).not.toContain('isCorrect');

      await answerAll(attemptId, questions, true);
      await http()
        .post(`/v1/learning/attempts/${attemptId}/submit`)
        .set(...student.authHeader)
        .expect(201);

      const afterSubmit = await http()
        .get(`/v1/learning/attempts/${attemptId}/result`)
        .set(...student.authHeader)
        .expect(200);
      expect(afterSubmit.body.questions[0].options[0]).toHaveProperty('isCorrect');
    });

    it('ответы сохраняются по одному и переживают повторное открытие', async () => {
      const { attemptId, questions } = await startTest();
      await http()
        .put(`/v1/learning/attempts/${attemptId}/answers/${questions[0]!.id}`)
        .set(...student.authHeader)
        .send({ selectedOptionIds: [questions[0]!.options[0]!.id] })
        .expect(204);

      const reopened = await http()
        .get(`/v1/learning/attempts/${attemptId}`)
        .set(...student.authHeader)
        .expect(200);
      expect(reopened.body.questions[0].answer.selectedOptionIds).toHaveLength(1);
    });

    it('нельзя начать вторую попытку, пока идёт первая', async () => {
      await startTest();
      const res = await http()
        .post(`/v1/learning/enrollments/${enrollmentId}/exams/test-1/attempts`)
        .set(...student.authHeader)
        .expect(409);
      expect(res.body.error.code).toBe('attempt_in_progress');
    });

    it('лимит попыток исчерпывается', async () => {
      for (let i = 0; i < 3; i += 1) {
        const { attemptId, questions } = await startTest();
        await answerAll(attemptId, questions, false);
        await http()
          .post(`/v1/learning/attempts/${attemptId}/submit`)
          .set(...student.authHeader)
          .expect(201);
      }

      const res = await http()
        .post(`/v1/learning/enrollments/${enrollmentId}/exams/test-1/attempts`)
        .set(...student.authHeader)
        .expect(409);
      expect(res.body.error.code).toBe('attempt_limit_reached');
    });

    it('пауза между попытками соблюдается', async () => {
      const exam = await ctx.prisma.exam.findFirst({ where: { key: 'test-1' } });
      await ctx.prisma.exam.update({ where: { id: exam!.id }, data: { cooldownHours: 12 } });

      const { attemptId, questions } = await startTest();
      await answerAll(attemptId, questions, false);
      await http()
        .post(`/v1/learning/attempts/${attemptId}/submit`)
        .set(...student.authHeader)
        .expect(201);

      const res = await http()
        .post(`/v1/learning/enrollments/${enrollmentId}/exams/test-1/attempts`)
        .set(...student.authHeader)
        .expect(409);
      expect(res.body.error.code).toBe('attempt_cooldown');
      expect(res.body.error.message).toMatch(/через \d+ ч/);
    });

    it('после сдачи новую попытку начать нельзя', async () => {
      const { attemptId, questions } = await startTest();
      await answerAll(attemptId, questions, true);
      await http()
        .post(`/v1/learning/attempts/${attemptId}/submit`)
        .set(...student.authHeader)
        .expect(201);

      const exam = await http()
        .get(`/v1/learning/enrollments/${enrollmentId}/exams/test-1`)
        .set(...student.authHeader)
        .expect(200);
      expect(exam.body.passed).toBe(true);
      expect(exam.body.availability.canStart).toBe(false);
      expect(exam.body.availability.reason).toMatch(/уже сдан/);
    });

    it('истёкшее время закрывает попытку с проверкой данных ответов', async () => {
      const exam = await ctx.prisma.exam.findFirst({ where: { key: 'test-1' } });
      await ctx.prisma.exam.update({ where: { id: exam!.id }, data: { timeLimitSec: 600 } });

      const { attemptId, questions } = await startTest();
      // Ответил только на первый вопрос и не успел завершить.
      await http()
        .put(`/v1/learning/attempts/${attemptId}/answers/${questions[0]!.id}`)
        .set(...student.authHeader)
        .send({ selectedOptionIds: [questions[0]!.options[0]!.id] })
        .expect(204);

      await ctx.prisma.examAttempt.update({
        where: { id: attemptId },
        data: { deadlineAt: new Date(Date.now() - 1000) },
      });
      const expired = await ctx.app.get(ExamsService).expireOverdue();
      expect(expired).toBe(1);

      const attempt = await ctx.prisma.examAttempt.findUnique({ where: { id: attemptId } });
      expect(attempt?.status).toBe('expired');
      // Один балл из четырёх: то, что успел ответить, засчитано.
      expect(attempt?.score).toBe(1);
      expect(attempt?.passed).toBe(false);
    });

    it('после дедлайна ответ не принимается', async () => {
      const { attemptId, questions } = await startTest();
      await ctx.prisma.examAttempt.update({
        where: { id: attemptId },
        data: { deadlineAt: new Date(Date.now() - 1000) },
      });

      const res = await http()
        .put(`/v1/learning/attempts/${attemptId}/answers/${questions[0]!.id}`)
        .set(...student.authHeader)
        .send({ selectedOptionIds: [questions[0]!.options[0]!.id] })
        .expect(409);
      expect(res.body.error.code).toBe('exam_expired');
    });

    it('выборка ограничивает число вопросов в попытке', async () => {
      const exam = await ctx.prisma.exam.findFirst({ where: { key: 'test-1' } });
      await ctx.prisma.exam.update({
        where: { id: exam!.id },
        data: { questionsPerAttempt: 2, shuffleQuestions: true },
      });

      const { questions } = await startTest();
      expect(questions).toHaveLength(2);
    });

    it('нельзя ответить на вопрос вне выборки', async () => {
      const exam = await ctx.prisma.exam.findFirst({ where: { key: 'test-1' } });
      await ctx.prisma.exam.update({
        where: { id: exam!.id },
        data: { questionsPerAttempt: 1, shuffleQuestions: false },
      });

      const { attemptId, questions } = await startTest();
      const all = await ctx.prisma.question.findMany({ where: { examId: exam!.id } });
      const outside = all.find((q) => q.id !== questions[0]!.id)!;

      await http()
        .put(`/v1/learning/attempts/${attemptId}/answers/${outside.id}`)
        .set(...student.authHeader)
        .send({ selectedOptionIds: [] })
        .expect(404);
    });
  });

  describe('практический экзамен', () => {
    async function submitPractical(): Promise<string> {
      const start = await http()
        .post(`/v1/learning/enrollments/${enrollmentId}/exams/final/attempts`)
        .set(...student.authHeader)
        .expect(201);
      const attemptId = start.body.id;

      const fileId = await createReadyAttemptFile(ctx, student.id);
      await http()
        .post(`/v1/learning/attempts/${attemptId}/files`)
        .set(...student.authHeader)
        .send({ fileId })
        .expect(201);

      await http()
        .post(`/v1/learning/attempts/${attemptId}/submit`)
        .set(...student.authHeader)
        .expect(201);
      return attemptId;
    }

    it('без материалов отправить нельзя', async () => {
      const start = await http()
        .post(`/v1/learning/enrollments/${enrollmentId}/exams/final/attempts`)
        .set(...student.authHeader)
        .expect(201);

      const res = await http()
        .post(`/v1/learning/attempts/${start.body.id}/submit`)
        .set(...student.authHeader)
        .expect(422);
      expect(res.body.error.message).toMatch(/материалы/i);
    });

    it('попадает в очередь куратора и оценивается', async () => {
      const attemptId = await submitPractical();

      const queue = await http()
        .get('/v1/curator/exam-queue')
        .set(...curator.authHeader)
        .expect(200);
      expect(queue.body).toHaveLength(1);
      expect(queue.body[0].examTitle).toBe('Практический экзамен');

      await http()
        .post(`/v1/curator/attempts/${attemptId}/grade`)
        .set(...curator.authHeader)
        .send({ score: 75, comment: 'Форма восстановлена, есть замечания по свету.' })
        .expect(204);

      const attempt = await ctx.prisma.examAttempt.findUnique({ where: { id: attemptId } });
      expect(attempt?.status).toBe('graded');
      expect(attempt?.passed).toBe(true);
      expect(attempt?.percent).toBe(75);
    });

    it('оценка ниже порога не засчитывается', async () => {
      const attemptId = await submitPractical();
      await http()
        .post(`/v1/curator/attempts/${attemptId}/grade`)
        .set(...curator.authHeader)
        .send({ score: 40, comment: 'Нужно переделать' })
        .expect(204);

      const attempt = await ctx.prisma.examAttempt.findUnique({ where: { id: attemptId } });
      expect(attempt?.passed).toBe(false);
    });

    it('повторная оценка отклоняется', async () => {
      const attemptId = await submitPractical();
      await http()
        .post(`/v1/curator/attempts/${attemptId}/grade`)
        .set(...curator.authHeader)
        .send({ score: 70, comment: 'Принято' })
        .expect(204);
      await http()
        .post(`/v1/curator/attempts/${attemptId}/grade`)
        .set(...curator.authHeader)
        .send({ score: 90, comment: 'Передумал' })
        .expect(409);
    });

    it('куратор чужой группы не видит попытку', async () => {
      const attemptId = await submitPractical();
      const foreign = await createUser(ctx, { platformRoles: ['curator'] });

      const queue = await http()
        .get('/v1/curator/exam-queue')
        .set(...foreign.authHeader)
        .expect(200);
      expect(queue.body).toHaveLength(0);
      await http()
        .get(`/v1/curator/attempts/${attemptId}`)
        .set(...foreign.authHeader)
        .expect(404);
    });

    it('материалы экзамена доступны куратору группы, но не чужим', async () => {
      const attemptId = await submitPractical();
      const link = await ctx.prisma.attemptFile.findFirst({ where: { attemptId } });

      await http()
        .get(`/v1/files/${link!.fileId}/url`)
        .set(...curator.authHeader)
        .expect(200);
      const foreign = await createUser(ctx, { platformRoles: ['curator'] });
      await http()
        .get(`/v1/files/${link!.fileId}/url`)
        .set(...foreign.authHeader)
        .expect(404);
    });
  });

  describe('влияние на прогресс', () => {
    it('сданные экзамены закрывают этап и открывают следующий', async () => {
      const { attemptId, questions } = await startTest();
      await answerAll(attemptId, questions, true);
      await http()
        .post(`/v1/learning/attempts/${attemptId}/submit`)
        .set(...student.authHeader)
        .expect(201);

      const start = await http()
        .post(`/v1/learning/enrollments/${enrollmentId}/exams/final/attempts`)
        .set(...student.authHeader)
        .expect(201);
      const fileId = await createReadyAttemptFile(ctx, student.id);
      await http()
        .post(`/v1/learning/attempts/${start.body.id}/files`)
        .set(...student.authHeader)
        .send({ fileId })
        .expect(201);
      await http()
        .post(`/v1/learning/attempts/${start.body.id}/submit`)
        .set(...student.authHeader)
        .expect(201);
      await http()
        .post(`/v1/curator/attempts/${start.body.id}/grade`)
        .set(...curator.authHeader)
        .send({ score: 80, comment: 'Хорошо' })
        .expect(204);

      await http()
        .post(`/v1/learning/enrollments/${enrollmentId}/lessons/light/complete`)
        .set(...student.authHeader)
        .expect(201);

      const map = await http()
        .get(`/v1/learning/enrollments/${enrollmentId}`)
        .set(...student.authHeader)
        .expect(200);
      expect(map.body.stages[0].progress.exams).toEqual({ done: 2, total: 2 });
      expect(map.body.stages[0].access.status).toBe('completed');
      expect(map.body.stages[1].access.status).toBe('open');
    });

    it('ученик получает уведомление о результате', async () => {
      const { attemptId, questions } = await startTest();
      await answerAll(attemptId, questions, true);
      await http()
        .post(`/v1/learning/attempts/${attemptId}/submit`)
        .set(...student.authHeader)
        .expect(201);

      const notification = await ctx.prisma.notification.findFirst({
        where: { userId: student.id, type: 'exam_graded' },
      });
      expect(notification).not.toBeNull();
      expect((notification!.payload as { passed: boolean }).passed).toBe(true);
    });

    it('аннулирование попытки администратором снимает зачёт', async () => {
      const { attemptId, questions } = await startTest();
      await answerAll(attemptId, questions, true);
      await http()
        .post(`/v1/learning/attempts/${attemptId}/submit`)
        .set(...student.authHeader)
        .expect(201);

      await http()
        .post(`/v1/admin/attempts/${attemptId}/cancel`)
        .set(...admin.authHeader)
        .send({ reason: 'подозрение на списывание' })
        .expect(204);

      const passed = await ctx.app.get(ExamsService).passedExamKeys(enrollmentId);
      expect(passed).not.toContain('test-1');
    });

    it('куратор не может аннулировать попытку', async () => {
      const { attemptId } = await startTest();
      await http()
        .post(`/v1/admin/attempts/${attemptId}/cancel`)
        .set(...curator.authHeader)
        .send({ reason: 'нет' })
        .expect(403);
    });
  });

  describe('доступ', () => {
    it('чужая попытка недоступна', async () => {
      const { attemptId } = await startTest();
      const stranger = await createUser(ctx);
      await http()
        .get(`/v1/learning/attempts/${attemptId}`)
        .set(...stranger.authHeader)
        .expect(404);
    });

    it('экзамен закрытого этапа недоступен', async () => {
      const course = await createPublishedCourse(ctx, {
        adminId: admin.id,
        stages: [
          { key: 'stage-1', title: 'База', unlockDaysOffset: 0, lessons: ['light'] },
          {
            key: 'stage-2',
            title: 'Сложное',
            unlockDaysOffset: 30,
            lessons: ['hail'],
            exams: [{ key: 'test-2', title: 'Тест', kind: 'test', passingScore: 70 }],
          },
        ],
      });
      const other = await enrollStudent(ctx, {
        cohortId: course.cohortId,
        courseId: course.courseId,
        userId: student.id,
        grantedById: admin.id,
      });

      const res = await http()
        .post(`/v1/learning/enrollments/${other}/exams/test-2/attempts`)
        .set(...student.authHeader)
        .expect(403);
      expect(res.body.error.code).toBe('stage_locked');
    });
  });
});
