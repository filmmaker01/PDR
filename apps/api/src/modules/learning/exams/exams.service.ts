import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type ExamAttempt } from '@prisma/client';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { AppError } from '@/common/errors/app.error';
import { FilesService } from '@/modules/files/files.service';
import { NotificationsService } from '@/modules/notifications/notifications.service';
import { StageAccessService } from '@/modules/learning/progress/stage-access.service';
import { ProgressService } from '@/modules/learning/progress/progress.service';
import type { VersionTree } from '@/modules/learning/catalog/catalog.service';
import { gradeAttempt, pickQuestions, type QuestionForGrading } from './grading';

type ExamNode = VersionTree['stages'][number]['exams'][number];

export interface AttemptAvailability {
  canStart: boolean;
  reason: string | null;
  attemptsUsed: number;
  attemptsLeft: number | null;
  nextAttemptAt: string | null;
}

@Injectable()
export class ExamsService {
  private readonly logger = new Logger(ExamsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stageAccess: StageAccessService,
    private readonly progress: ProgressService,
    private readonly notifications: NotificationsService,
    private readonly files: FilesService,
  ) {}

  private async findExam(enrollmentId: string, examKey: string) {
    const ctx = await this.stageAccess.loadContext(enrollmentId);
    const stage = ctx.version.stages.find((s) => s.exams.some((e) => e.key === examKey));
    const exam = stage?.exams.find((e) => e.key === examKey);
    if (!stage || !exam) throw AppError.notFound('Экзамен не найден');
    return { ctx, stage, exam };
  }

  /** Можно ли начать попытку: лимит, пауза, незавершённая попытка. */
  async availability(enrollmentId: string, exam: ExamNode): Promise<AttemptAvailability> {
    const attempts = await this.prisma.examAttempt.findMany({
      where: { enrollmentId, examKey: exam.key, status: { not: 'cancelled' } },
      orderBy: { attemptNo: 'desc' },
    });

    const active = attempts.find((a) => a.status === 'in_progress');
    if (active) {
      return {
        canStart: false,
        reason: 'У вас уже есть незавершённая попытка',
        attemptsUsed: attempts.length,
        attemptsLeft: exam.maxAttempts ? exam.maxAttempts - attempts.length : null,
        nextAttemptAt: null,
      };
    }

    if (attempts.some((a) => a.passed === true)) {
      return {
        canStart: false,
        reason: 'Экзамен уже сдан',
        attemptsUsed: attempts.length,
        attemptsLeft: exam.maxAttempts ? exam.maxAttempts - attempts.length : null,
        nextAttemptAt: null,
      };
    }

    if (exam.maxAttempts !== null && attempts.length >= exam.maxAttempts) {
      return {
        canStart: false,
        reason: `Исчерпаны все попытки (${exam.maxAttempts}). Обратитесь к администратору`,
        attemptsUsed: attempts.length,
        attemptsLeft: 0,
        nextAttemptAt: null,
      };
    }

    const last = attempts[0];
    if (exam.cooldownHours > 0 && last?.submittedAt) {
      const nextAt = new Date(last.submittedAt.getTime() + exam.cooldownHours * 3_600_000);
      if (nextAt.getTime() > Date.now()) {
        const hoursLeft = Math.ceil((nextAt.getTime() - Date.now()) / 3_600_000);
        return {
          canStart: false,
          reason: `Пересдать можно через ${hoursLeft} ч`,
          attemptsUsed: attempts.length,
          attemptsLeft: exam.maxAttempts ? exam.maxAttempts - attempts.length : null,
          nextAttemptAt: nextAt.toISOString(),
        };
      }
    }

    return {
      canStart: true,
      reason: null,
      attemptsUsed: attempts.length,
      attemptsLeft: exam.maxAttempts ? exam.maxAttempts - attempts.length : null,
      nextAttemptAt: null,
    };
  }

  /** Экран правил экзамена с историей попыток. */
  async examDetails(enrollmentId: string, examKey: string) {
    const { stage, exam } = await this.findExam(enrollmentId, examKey);
    await this.stageAccess.assertStageOpen(enrollmentId, stage.key);

    const availability = await this.availability(enrollmentId, exam);
    const attempts = await this.prisma.examAttempt.findMany({
      where: { enrollmentId, examKey },
      orderBy: { attemptNo: 'desc' },
    });

    return {
      key: exam.key,
      stageKey: stage.key,
      title: exam.title,
      kind: exam.kind,
      description: exam.description,
      passingScore: exam.passingScore,
      maxAttempts: exam.maxAttempts,
      timeLimitSec: exam.timeLimitSec,
      cooldownHours: exam.cooldownHours,
      questionsCount:
        exam.kind === 'test' ? (exam.questionsPerAttempt ?? exam.questions.length) : null,
      passed: attempts.some((a) => a.passed === true),
      availability,
      activeAttemptId: attempts.find((a) => a.status === 'in_progress')?.id ?? null,
      attempts: attempts.map((attempt) => ({
        id: attempt.id,
        attemptNo: attempt.attemptNo,
        status: attempt.status,
        percent: attempt.percent,
        passed: attempt.passed,
        submittedAt: attempt.submittedAt?.toISOString() ?? null,
        gradedAt: attempt.gradedAt?.toISOString() ?? null,
      })),
    };
  }

  /** Старт попытки: фиксируем выборку вопросов и дедлайн. */
  async startAttempt(enrollmentId: string, examKey: string): Promise<ExamAttempt> {
    const { stage, exam } = await this.findExam(enrollmentId, examKey);
    await this.stageAccess.assertStageOpen(enrollmentId, stage.key);

    const availability = await this.availability(enrollmentId, exam);
    if (!availability.canStart) {
      const code =
        availability.attemptsLeft === 0
          ? 'attempt_limit_reached'
          : availability.nextAttemptAt
            ? 'attempt_cooldown'
            : 'attempt_in_progress';
      throw new AppError(code, availability.reason ?? 'Попытка сейчас недоступна');
    }

    const last = await this.prisma.examAttempt.findFirst({
      where: { enrollmentId, examKey },
      orderBy: { attemptNo: 'desc' },
      select: { attemptNo: true },
    });

    const questionOrder =
      exam.kind === 'test'
        ? pickQuestions(
            exam.questions.map((q) => q.id),
            { shuffle: exam.shuffleQuestions, take: exam.questionsPerAttempt },
          )
        : [];

    return this.prisma.examAttempt.create({
      data: {
        enrollmentId,
        examKey,
        examId: exam.id,
        attemptNo: (last?.attemptNo ?? 0) + 1,
        status: 'in_progress',
        startedAt: new Date(),
        deadlineAt: exam.timeLimitSec ? new Date(Date.now() + exam.timeLimitSec * 1000) : null,
        questionOrder: questionOrder as Prisma.InputJsonValue,
      },
    });
  }

  async getOwnAttempt(attemptId: string, enrollmentId: string): Promise<ExamAttempt> {
    const attempt = await this.prisma.examAttempt.findUnique({ where: { id: attemptId } });
    if (!attempt || attempt.enrollmentId !== enrollmentId) {
      throw AppError.notFound('Попытка не найдена');
    }
    return attempt;
  }

  /**
   * Состояние попытки для ученика.
   * Правильные ответы не отдаются до завершения — иначе тест бессмыслен.
   */
  async attemptState(attemptId: string, enrollmentId: string) {
    const attempt = await this.getOwnAttempt(attemptId, enrollmentId);
    const { exam } = await this.findExam(enrollmentId, attempt.examKey);

    const order = (attempt.questionOrder ?? []) as string[];
    const questions = order
      .map((id) => exam.questions.find((q) => q.id === id))
      .filter((q): q is NonNullable<typeof q> => q !== undefined);

    const answers = await this.prisma.attemptAnswer.findMany({ where: { attemptId } });
    const answerByQuestion = new Map(answers.map((a) => [a.questionId, a]));

    const finished = attempt.status !== 'in_progress';

    return {
      id: attempt.id,
      examKey: attempt.examKey,
      kind: exam.kind,
      status: attempt.status,
      attemptNo: attempt.attemptNo,
      startedAt: attempt.startedAt.toISOString(),
      deadlineAt: attempt.deadlineAt?.toISOString() ?? null,
      secondsLeft: attempt.deadlineAt
        ? Math.max(0, Math.round((attempt.deadlineAt.getTime() - Date.now()) / 1000))
        : null,
      questions: questions.map((question) => {
        const answer = answerByQuestion.get(question.id);
        return {
          id: question.id,
          kind: question.kind,
          body: question.body,
          points: question.points,
          options: question.options.map((option) => ({
            id: option.id,
            body: option.body,
            // Правильность раскрывается только после завершения попытки.
            ...(finished ? { isCorrect: option.isCorrect } : {}),
          })),
          answer: answer
            ? {
                selectedOptionIds: answer.selectedOptionIds,
                textAnswer: answer.textAnswer,
                ...(finished
                  ? { isCorrect: answer.isCorrect, pointsAwarded: answer.pointsAwarded }
                  : {}),
              }
            : null,
          ...(finished && exam.showExplanations ? { explanation: question.explanation } : {}),
        };
      }),
    };
  }

  /** Ответ сохраняется сразу: обрыв связи не должен стоить попытки. */
  async saveAnswer(
    attemptId: string,
    enrollmentId: string,
    questionId: string,
    input: { selectedOptionIds?: string[]; textAnswer?: string | null },
  ): Promise<void> {
    const attempt = await this.getOwnAttempt(attemptId, enrollmentId);
    if (attempt.status !== 'in_progress') {
      throw AppError.conflict('Попытка уже завершена');
    }
    if (attempt.deadlineAt && attempt.deadlineAt.getTime() <= Date.now()) {
      throw new AppError('exam_expired', 'Время вышло, попытка завершается');
    }

    const order = (attempt.questionOrder ?? []) as string[];
    if (order.length > 0 && !order.includes(questionId)) {
      throw AppError.notFound('Вопрос не входит в эту попытку');
    }

    await this.prisma.attemptAnswer.upsert({
      where: { attemptId_questionId: { attemptId, questionId } },
      create: {
        attemptId,
        questionId,
        selectedOptionIds: input.selectedOptionIds ?? [],
        textAnswer: input.textAnswer ?? null,
      },
      update: {
        selectedOptionIds: input.selectedOptionIds ?? [],
        textAnswer: input.textAnswer ?? null,
        answeredAt: new Date(),
      },
    });
  }

  async attachFile(attemptId: string, enrollmentId: string, fileId: string): Promise<void> {
    const attempt = await this.getOwnAttempt(attemptId, enrollmentId);
    if (attempt.status !== 'in_progress') throw AppError.conflict('Попытка уже завершена');

    const file = await this.files.getById(fileId);
    if (file.scope !== 'exam_attempt') {
      throw AppError.validation('Этот файл нельзя приложить к экзамену');
    }
    const enrollment = await this.prisma.enrollment.findUnique({
      where: { id: enrollmentId },
      select: { userId: true },
    });
    if (file.ownerUserId !== enrollment?.userId) throw AppError.notFound('Файл не найден');

    const last = await this.prisma.attemptFile.findFirst({
      where: { attemptId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    await this.prisma.attemptFile
      .create({ data: { attemptId, fileId, position: (last?.position ?? 0) + 1 } })
      .catch(() => undefined);
  }

  /**
   * Завершение попытки.
   * Тест проверяется сразу, практический экзамен уходит на оценку куратору.
   */
  async submitAttempt(attemptId: string, enrollmentId: string): Promise<ExamAttempt> {
    const attempt = await this.getOwnAttempt(attemptId, enrollmentId);
    if (attempt.status !== 'in_progress') throw AppError.conflict('Попытка уже завершена');

    const { exam } = await this.findExam(enrollmentId, attempt.examKey);

    if (exam.kind === 'practical') {
      const files = await this.prisma.attemptFile.count({ where: { attemptId } });
      if (files === 0) {
        throw AppError.validation('Приложите материалы работы перед отправкой на оценку');
      }
      const updated = await this.prisma.examAttempt.update({
        where: { id: attemptId },
        data: { status: 'submitted', submittedAt: new Date() },
      });
      return updated;
    }

    return this.autoGrade(attemptId, 'submitted');
  }

  /** Автопроверка теста. Используется и при завершении, и при истечении времени. */
  async autoGrade(attemptId: string, reason: 'submitted' | 'expired'): Promise<ExamAttempt> {
    const attempt = await this.prisma.examAttempt.findUnique({
      where: { id: attemptId },
      include: {
        exam: { include: { questions: { include: { options: true } } } },
        answers: true,
        enrollment: { select: { userId: true } },
      },
    });
    if (!attempt) throw AppError.notFound('Попытка не найдена');
    if (attempt.status !== 'in_progress') return attempt;

    const order = (attempt.questionOrder ?? []) as string[];
    const questions: QuestionForGrading[] = attempt.exam.questions
      .filter((q) => order.length === 0 || order.includes(q.id))
      .map((q) => ({
        id: q.id,
        kind: q.kind,
        points: q.points,
        options: q.options.map((o) => ({ id: o.id, isCorrect: o.isCorrect })),
        acceptedAnswers: (q.acceptedAnswers ?? null) as string[] | null,
      }));

    const result = gradeAttempt(
      questions,
      attempt.answers.map((a) => ({
        questionId: a.questionId,
        selectedOptionIds: a.selectedOptionIds,
        textAnswer: a.textAnswer,
      })),
      attempt.exam.passingScore,
    );

    const updated = await this.prisma.transaction(async (tx) => {
      for (const graded of result.answers) {
        await tx.attemptAnswer.updateMany({
          where: { attemptId, questionId: graded.questionId },
          data: { isCorrect: graded.isCorrect, pointsAwarded: graded.pointsAwarded },
        });
      }
      return tx.examAttempt.update({
        where: { id: attemptId },
        data: {
          status: reason === 'expired' ? 'expired' : 'graded',
          submittedAt: attempt.submittedAt ?? new Date(),
          gradedAt: new Date(),
          score: result.score,
          maxScore: result.maxScore,
          percent: result.percent,
          passed: result.passed,
        },
      });
    });

    await this.afterGrading(
      updated,
      attempt.enrollment.userId,
      attempt.exam.title,
      attempt.exam.passingScore,
    );
    return updated;
  }

  /** Оценка практического экзамена куратором. */
  async gradePractical(
    attemptId: string,
    graderId: string,
    input: { score: number; comment: string },
  ): Promise<ExamAttempt> {
    const attempt = await this.prisma.examAttempt.findUnique({
      where: { id: attemptId },
      include: { exam: true, enrollment: { select: { userId: true } } },
    });
    if (!attempt) throw AppError.notFound('Попытка не найдена');
    if (attempt.exam.kind !== 'practical') {
      throw AppError.conflict('Тест проверяется автоматически');
    }
    if (attempt.status === 'graded') throw AppError.conflict('Попытка уже оценена');
    if (attempt.status !== 'submitted') {
      throw AppError.conflict('Попытка ещё не отправлена на оценку');
    }

    const percent = Math.min(Math.max(input.score, 0), 100);
    const updated = await this.prisma.examAttempt.update({
      where: { id: attemptId },
      data: {
        status: 'graded',
        gradedAt: new Date(),
        graderId,
        graderComment: input.comment,
        score: percent,
        maxScore: 100,
        percent,
        passed: percent >= attempt.exam.passingScore,
      },
    });

    await this.afterGrading(
      updated,
      attempt.enrollment.userId,
      attempt.exam.title,
      attempt.exam.passingScore,
    );
    return updated;
  }

  private async afterGrading(
    attempt: ExamAttempt,
    userId: string,
    examTitle: string,
    passingScore: number,
  ): Promise<void> {
    await this.notifications.notify({
      userId,
      type: 'exam_graded',
      payload: {
        examTitle,
        percent: attempt.percent ?? 0,
        passed: attempt.passed === true,
        passingScore,
        attemptId: attempt.id,
      },
      dedupeKey: `exam_graded:${attempt.id}`,
    });

    // Сданный экзамен может завершить этап и открыть следующий.
    await this.progress.recalculate(attempt.enrollmentId);
    this.logger.log(
      { attemptId: attempt.id, percent: attempt.percent, passed: attempt.passed },
      'Попытка оценена',
    );
  }

  /** Просроченные попытки: закрываем с автопроверкой того, что есть. */
  async expireOverdue(): Promise<number> {
    const overdue = await this.prisma.examAttempt.findMany({
      where: { status: 'in_progress', deadlineAt: { not: null, lte: new Date() } },
      select: { id: true, examId: true },
    });

    let expired = 0;
    for (const attempt of overdue) {
      const exam = await this.prisma.exam.findUnique({
        where: { id: attempt.examId },
        select: { kind: true },
      });
      if (exam?.kind === 'test') {
        await this.autoGrade(attempt.id, 'expired').catch(() => undefined);
      } else {
        await this.prisma.examAttempt.update({
          where: { id: attempt.id },
          data: { status: 'expired' },
        });
      }
      expired += 1;
    }
    if (expired > 0) this.logger.log(`Закрыто просроченных попыток: ${expired}`);
    return expired;
  }

  /** Ключи сданных экзаменов — источник фактов для правил открытия этапов. */
  async passedExamKeys(enrollmentId: string): Promise<string[]> {
    const rows = await this.prisma.examAttempt.findMany({
      where: { enrollmentId, passed: true },
      select: { examKey: true },
      distinct: ['examKey'],
    });
    return rows.map((r) => r.examKey);
  }

  /** Аннулирование попытки администратором. */
  async cancelAttempt(attemptId: string, reason: string): Promise<void> {
    const attempt = await this.prisma.examAttempt.findUnique({ where: { id: attemptId } });
    if (!attempt) throw AppError.notFound('Попытка не найдена');

    await this.prisma.examAttempt.update({
      where: { id: attemptId },
      data: { status: 'cancelled', passed: false, cancelReason: reason },
    });
    await this.progress.recalculate(attempt.enrollmentId);
  }

  /** Очередь практических экзаменов на оценку. */
  async gradingQueue(cohortIds: string[] | null, limit: number) {
    const attempts = await this.prisma.examAttempt.findMany({
      where: {
        status: 'submitted',
        exam: { kind: 'practical' },
        ...(cohortIds ? { enrollment: { cohortId: { in: cohortIds } } } : {}),
      },
      orderBy: { submittedAt: 'asc' },
      take: limit,
      include: {
        exam: { select: { title: true, passingScore: true } },
        enrollment: {
          include: {
            user: { select: { firstName: true, lastName: true, username: true } },
            cohort: { select: { id: true, title: true } },
          },
        },
        files: { select: { fileId: true } },
      },
    });

    return attempts.map((attempt) => ({
      id: attempt.id,
      examKey: attempt.examKey,
      examTitle: attempt.exam.title,
      passingScore: attempt.exam.passingScore,
      attemptNo: attempt.attemptNo,
      submittedAt: attempt.submittedAt?.toISOString() ?? null,
      waitingHours: attempt.submittedAt
        ? Math.floor((Date.now() - attempt.submittedAt.getTime()) / 3_600_000)
        : 0,
      filesCount: attempt.files.length,
      student: {
        name: [attempt.enrollment.user.firstName, attempt.enrollment.user.lastName]
          .filter(Boolean)
          .join(' '),
        username: attempt.enrollment.user.username,
      },
      cohort: attempt.enrollment.cohort,
    }));
  }

  async attemptForGrading(attemptId: string) {
    const attempt = await this.prisma.examAttempt.findUnique({
      where: { id: attemptId },
      include: {
        exam: { select: { title: true, kind: true, passingScore: true, description: true } },
        enrollment: {
          include: {
            user: { select: { id: true, firstName: true, lastName: true, username: true } },
            cohort: { select: { id: true, title: true } },
          },
        },
        files: { include: { file: true }, orderBy: { position: 'asc' } },
      },
    });
    if (!attempt) throw AppError.notFound('Попытка не найдена');
    return attempt;
  }
}
