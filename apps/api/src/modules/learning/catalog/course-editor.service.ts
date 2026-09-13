import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Assignment, Exam, Lesson, LessonMaterial, Question, Stage } from '@prisma/client';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { AppError } from '@/common/errors/app.error';
import { CatalogService } from './catalog.service';

/** Ключ элемента курса: латиница, цифры и дефис — он попадает в ссылки и прогресс. */
const KEY_RE = /^[a-z0-9][a-z0-9-]{0,58}[a-z0-9]$/;

function assertKey(key: string): void {
  if (!KEY_RE.test(key)) {
    throw AppError.validation(
      'Ключ должен состоять из латиницы, цифр и дефисов, например «stage-1»',
    );
  }
}

/**
 * Редактирование структуры курса. Все операции работают только с черновиком:
 * опубликованная версия неизменяема, поэтому прогресс учеников не может
 * «поехать» из-за правки материалов.
 */
@Injectable()
export class CourseEditorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
  ) {}

  // ── Этапы ──────────────────────────────────────────────────────────────────

  async createStage(
    versionId: string,
    input: {
      key: string;
      title: string;
      description?: string | null;
      unlockDaysOffset?: number;
      requiresPreviousStage?: boolean;
    },
  ): Promise<Stage> {
    await this.catalog.assertDraft(versionId);
    assertKey(input.key);

    const last = await this.prisma.stage.findFirst({
      where: { courseVersionId: versionId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });

    return this.prisma.stage
      .create({
        data: {
          courseVersionId: versionId,
          key: input.key,
          position: (last?.position ?? 0) + 1,
          title: input.title,
          description: input.description ?? null,
          unlockDaysOffset: input.unlockDaysOffset ?? 0,
          requiresPreviousStage: input.requiresPreviousStage ?? true,
        },
      })
      .catch(() => {
        throw AppError.conflict('Этап с таким ключом уже есть в этой версии');
      });
  }

  async updateStage(
    stageId: string,
    input: Partial<{
      title: string;
      description: string | null;
      unlockDaysOffset: number;
      requiresPreviousStage: boolean;
      coverFileId: string | null;
    }>,
  ): Promise<Stage> {
    await this.catalog.assertDraft(await this.catalog.versionIdOfStage(stageId));
    return this.prisma.stage.update({ where: { id: stageId }, data: input });
  }

  async deleteStage(stageId: string): Promise<void> {
    await this.catalog.assertDraft(await this.catalog.versionIdOfStage(stageId));
    await this.prisma.stage.delete({ where: { id: stageId } });
  }

  /**
   * Изменение порядка. Позиции уникальны в пределах версии, поэтому
   * переставляем в два прохода: сначала во временный диапазон.
   */
  async reorderStages(versionId: string, orderedIds: string[]): Promise<void> {
    await this.catalog.assertDraft(versionId);
    const stages = await this.prisma.stage.findMany({
      where: { courseVersionId: versionId },
      select: { id: true },
    });
    this.assertSameSet(
      stages.map((s) => s.id),
      orderedIds,
    );

    await this.prisma.transaction(async (tx) => {
      for (const [index, id] of orderedIds.entries()) {
        await tx.stage.update({ where: { id }, data: { position: -(index + 1) } });
      }
      for (const [index, id] of orderedIds.entries()) {
        await tx.stage.update({ where: { id }, data: { position: index + 1 } });
      }
    });
  }

  // ── Уроки ──────────────────────────────────────────────────────────────────

  async createLesson(
    stageId: string,
    input: {
      key: string;
      title: string;
      description?: string | null;
      isRequired?: boolean;
      videoAssetId?: string | null;
      minWatchPercent?: number;
      estimatedMinutes?: number | null;
    },
  ): Promise<Lesson> {
    await this.catalog.assertDraft(await this.catalog.versionIdOfStage(stageId));
    assertKey(input.key);

    const last = await this.prisma.lesson.findFirst({
      where: { stageId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });

    return this.prisma.lesson
      .create({
        data: {
          stageId,
          key: input.key,
          position: (last?.position ?? 0) + 1,
          title: input.title,
          description: input.description ?? null,
          isRequired: input.isRequired ?? true,
          videoAssetId: input.videoAssetId ?? null,
          minWatchPercent: input.minWatchPercent ?? 0,
          estimatedMinutes: input.estimatedMinutes ?? null,
        },
      })
      .catch(() => {
        throw AppError.conflict('Урок с таким ключом уже есть в этом этапе');
      });
  }

  async updateLesson(
    lessonId: string,
    input: Partial<{
      title: string;
      description: string | null;
      isRequired: boolean;
      videoAssetId: string | null;
      minWatchPercent: number;
      estimatedMinutes: number | null;
    }>,
  ): Promise<Lesson> {
    await this.catalog.assertDraft(await this.catalog.versionIdOfLesson(lessonId));
    return this.prisma.lesson.update({ where: { id: lessonId }, data: input });
  }

  async deleteLesson(lessonId: string): Promise<void> {
    await this.catalog.assertDraft(await this.catalog.versionIdOfLesson(lessonId));
    await this.prisma.lesson.delete({ where: { id: lessonId } });
  }

  async reorderLessons(stageId: string, orderedIds: string[]): Promise<void> {
    await this.catalog.assertDraft(await this.catalog.versionIdOfStage(stageId));
    const lessons = await this.prisma.lesson.findMany({ where: { stageId }, select: { id: true } });
    this.assertSameSet(
      lessons.map((l) => l.id),
      orderedIds,
    );

    await this.prisma.transaction(async (tx) => {
      for (const [index, id] of orderedIds.entries()) {
        await tx.lesson.update({ where: { id }, data: { position: -(index + 1) } });
      }
      for (const [index, id] of orderedIds.entries()) {
        await tx.lesson.update({ where: { id }, data: { position: index + 1 } });
      }
    });
  }

  // ── Материалы ──────────────────────────────────────────────────────────────

  async createMaterial(
    lessonId: string,
    input: {
      kind: 'file' | 'link' | 'text';
      title: string;
      fileId?: string | null;
      url?: string | null;
      body?: string | null;
    },
  ): Promise<LessonMaterial> {
    await this.catalog.assertDraft(await this.catalog.versionIdOfLesson(lessonId));
    if (input.kind === 'file' && !input.fileId) throw AppError.validation('Выберите файл');
    if (input.kind === 'link' && !input.url) throw AppError.validation('Укажите ссылку');
    if (input.kind === 'text' && !input.body) throw AppError.validation('Заполните текст');

    const last = await this.prisma.lessonMaterial.findFirst({
      where: { lessonId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });

    return this.prisma.lessonMaterial.create({
      data: {
        lessonId,
        position: (last?.position ?? 0) + 1,
        kind: input.kind,
        title: input.title,
        fileId: input.fileId ?? null,
        url: input.url ?? null,
        body: input.body ?? null,
      },
    });
  }

  async deleteMaterial(materialId: string): Promise<void> {
    const material = await this.prisma.lessonMaterial.findUnique({
      where: { id: materialId },
      select: { lessonId: true },
    });
    if (!material) throw AppError.notFound('Материал не найден');
    await this.catalog.assertDraft(await this.catalog.versionIdOfLesson(material.lessonId));
    await this.prisma.lessonMaterial.delete({ where: { id: materialId } });
  }

  // ── Задания ────────────────────────────────────────────────────────────────

  async createAssignment(
    stageId: string,
    input: {
      key: string;
      title: string;
      instructions: string;
      lessonId?: string | null;
      isRequired?: boolean;
      requiredMedia?: { min_photos?: number; min_videos?: number; text_required?: boolean };
      maxVideoSec?: number | null;
    },
  ): Promise<Assignment> {
    await this.catalog.assertDraft(await this.catalog.versionIdOfStage(stageId));
    assertKey(input.key);

    const last = await this.prisma.assignment.findFirst({
      where: { stageId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });

    return this.prisma.assignment
      .create({
        data: {
          stageId,
          lessonId: input.lessonId ?? null,
          key: input.key,
          position: (last?.position ?? 0) + 1,
          title: input.title,
          instructions: input.instructions,
          isRequired: input.isRequired ?? true,
          requiredMedia: {
            min_photos: input.requiredMedia?.min_photos ?? 1,
            min_videos: input.requiredMedia?.min_videos ?? 0,
            text_required: input.requiredMedia?.text_required ?? false,
          } as Prisma.InputJsonValue,
          maxVideoSec: input.maxVideoSec ?? null,
        },
      })
      .catch(() => {
        throw AppError.conflict('Задание с таким ключом уже есть в этом этапе');
      });
  }

  async updateAssignment(
    assignmentId: string,
    input: Partial<{
      title: string;
      instructions: string;
      lessonId: string | null;
      isRequired: boolean;
      requiredMedia: { min_photos?: number; min_videos?: number; text_required?: boolean };
      maxVideoSec: number | null;
    }>,
  ): Promise<Assignment> {
    const assignment = await this.prisma.assignment.findUnique({
      where: { id: assignmentId },
      select: { stageId: true },
    });
    if (!assignment) throw AppError.notFound('Задание не найдено');
    await this.catalog.assertDraft(await this.catalog.versionIdOfStage(assignment.stageId));

    const { requiredMedia, ...rest } = input;
    return this.prisma.assignment.update({
      where: { id: assignmentId },
      data: {
        ...rest,
        ...(requiredMedia ? { requiredMedia: requiredMedia as Prisma.InputJsonValue } : {}),
      },
    });
  }

  async deleteAssignment(assignmentId: string): Promise<void> {
    const assignment = await this.prisma.assignment.findUnique({
      where: { id: assignmentId },
      select: { stageId: true },
    });
    if (!assignment) throw AppError.notFound('Задание не найдено');
    await this.catalog.assertDraft(await this.catalog.versionIdOfStage(assignment.stageId));
    await this.prisma.assignment.delete({ where: { id: assignmentId } });
  }

  // ── Экзамены и вопросы ─────────────────────────────────────────────────────

  async createExam(
    stageId: string,
    input: {
      key: string;
      title: string;
      kind: 'test' | 'practical';
      passingScore: number;
      description?: string | null;
      maxAttempts?: number | null;
      timeLimitSec?: number | null;
      cooldownHours?: number;
      shuffleQuestions?: boolean;
      questionsPerAttempt?: number | null;
      showExplanations?: boolean;
      isRequired?: boolean;
    },
  ): Promise<Exam> {
    await this.catalog.assertDraft(await this.catalog.versionIdOfStage(stageId));
    assertKey(input.key);

    const last = await this.prisma.exam.findFirst({
      where: { stageId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });

    return this.prisma.exam
      .create({
        data: {
          stageId,
          key: input.key,
          position: (last?.position ?? 0) + 1,
          title: input.title,
          kind: input.kind,
          description: input.description ?? null,
          passingScore: input.passingScore,
          maxAttempts: input.maxAttempts ?? null,
          timeLimitSec: input.timeLimitSec ?? null,
          cooldownHours: input.cooldownHours ?? 0,
          shuffleQuestions: input.shuffleQuestions ?? true,
          questionsPerAttempt: input.questionsPerAttempt ?? null,
          showExplanations: input.showExplanations ?? true,
          isRequired: input.isRequired ?? true,
        },
      })
      .catch(() => {
        throw AppError.conflict('Экзамен с таким ключом уже есть в этом этапе');
      });
  }

  async updateExam(
    examId: string,
    input: Partial<Omit<Exam, 'id' | 'stageId' | 'key' | 'position'>>,
  ): Promise<Exam> {
    await this.catalog.assertDraft(await this.catalog.versionIdOfExam(examId));
    return this.prisma.exam.update({ where: { id: examId }, data: input });
  }

  async deleteExam(examId: string): Promise<void> {
    await this.catalog.assertDraft(await this.catalog.versionIdOfExam(examId));
    await this.prisma.exam.delete({ where: { id: examId } });
  }

  /** Вопрос вместе с вариантами: разделять их в интерфейсе неудобно. */
  async upsertQuestion(
    examId: string,
    input: {
      questionId?: string;
      kind: 'single' | 'multiple' | 'boolean' | 'short_text';
      body: string;
      explanation?: string | null;
      points?: number;
      imageFileId?: string | null;
      acceptedAnswers?: string[] | null;
      options?: { body: string; isCorrect: boolean }[];
    },
  ): Promise<Question> {
    await this.catalog.assertDraft(await this.catalog.versionIdOfExam(examId));

    if (input.kind === 'short_text') {
      if (!input.acceptedAnswers || input.acceptedAnswers.length === 0) {
        throw AppError.validation('Укажите хотя бы один принимаемый ответ');
      }
    } else {
      const options = input.options ?? [];
      if (options.length < 2) throw AppError.validation('Нужно минимум два варианта ответа');
      const correct = options.filter((o) => o.isCorrect);
      if (correct.length === 0) throw AppError.validation('Отметьте правильный ответ');
      if (input.kind === 'single' && correct.length > 1) {
        throw AppError.validation('В вопросе с одним выбором правильный ответ должен быть один');
      }
    }

    return this.prisma.transaction(async (tx) => {
      let position: number;
      if (input.questionId) {
        const existing = await tx.question.findUnique({ where: { id: input.questionId } });
        if (!existing || existing.examId !== examId) throw AppError.notFound('Вопрос не найден');
        position = existing.position;
        await tx.questionOption.deleteMany({ where: { questionId: input.questionId } });
        await tx.question.delete({ where: { id: input.questionId } });
      } else {
        const last = await tx.question.findFirst({
          where: { examId },
          orderBy: { position: 'desc' },
          select: { position: true },
        });
        position = (last?.position ?? 0) + 1;
      }

      const question = await tx.question.create({
        data: {
          examId,
          position,
          kind: input.kind,
          body: input.body,
          explanation: input.explanation ?? null,
          points: input.points ?? 1,
          imageFileId: input.imageFileId ?? null,
          acceptedAnswers:
            input.kind === 'short_text'
              ? ((input.acceptedAnswers ?? []) as Prisma.InputJsonValue)
              : Prisma.DbNull,
        },
      });

      for (const [index, option] of (input.options ?? []).entries()) {
        await tx.questionOption.create({
          data: {
            questionId: question.id,
            position: index + 1,
            body: option.body,
            isCorrect: option.isCorrect,
          },
        });
      }
      return question;
    });
  }

  async deleteQuestion(questionId: string): Promise<void> {
    const question = await this.prisma.question.findUnique({
      where: { id: questionId },
      select: { examId: true },
    });
    if (!question) throw AppError.notFound('Вопрос не найден');
    await this.catalog.assertDraft(await this.catalog.versionIdOfExam(question.examId));
    await this.prisma.question.delete({ where: { id: questionId } });
  }

  private assertSameSet(actual: string[], provided: string[]): void {
    if (actual.length !== provided.length || new Set(provided).size !== provided.length) {
      throw AppError.validation('Список порядка должен содержать все элементы ровно один раз');
    }
    const set = new Set(actual);
    for (const id of provided) {
      if (!set.has(id)) throw AppError.validation('В списке порядка есть посторонний элемент');
    }
  }
}
