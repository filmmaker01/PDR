import { Injectable, Logger } from '@nestjs/common';
import type { Course, CourseVersion, Prisma } from '@prisma/client';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { AppError } from '@/common/errors/app.error';

/** Полная структура версии курса, как её видит редактор и сервис прогресса. */
export type VersionTree = Prisma.CourseVersionGetPayload<{
  include: {
    stages: {
      include: {
        lessons: { include: { materials: true; videoAsset: true } };
        assignments: true;
        exams: { include: { questions: { include: { options: true } } } };
      };
    };
  };
}>;

const VERSION_TREE_INCLUDE = {
  stages: {
    orderBy: { position: 'asc' },
    include: {
      lessons: {
        orderBy: { position: 'asc' },
        include: { materials: { orderBy: { position: 'asc' } }, videoAsset: true },
      },
      assignments: { orderBy: { position: 'asc' } },
      exams: {
        orderBy: { position: 'asc' },
        include: {
          questions: {
            orderBy: { position: 'asc' },
            include: { options: { orderBy: { position: 'asc' } } },
          },
        },
      },
    },
  },
} satisfies Prisma.CourseVersionInclude;

export interface PublishIssue {
  path: string;
  message: string;
}

@Injectable()
export class CatalogService {
  private readonly logger = new Logger(CatalogService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Курсы ──────────────────────────────────────────────────────────────────

  async listCourses(): Promise<(Course & { versions: CourseVersion[] })[]> {
    return this.prisma.course.findMany({
      orderBy: { createdAt: 'asc' },
      include: { versions: { orderBy: { versionNo: 'desc' } } },
    });
  }

  async createCourse(input: {
    slug: string;
    title: string;
    description?: string | null;
  }): Promise<Course> {
    const existing = await this.prisma.course.findUnique({ where: { slug: input.slug } });
    if (existing) throw AppError.conflict('Курс с таким адресом уже существует');

    return this.prisma.transaction(async (tx) => {
      const course = await tx.course.create({
        data: { slug: input.slug, title: input.title, description: input.description ?? null },
      });
      // У нового курса сразу появляется черновик, чтобы было что редактировать.
      await tx.courseVersion.create({
        data: { courseId: course.id, versionNo: 1, status: 'draft' },
      });
      return course;
    });
  }

  async updateCourse(
    courseId: string,
    input: { title?: string; description?: string | null; isActive?: boolean },
  ): Promise<Course> {
    await this.getCourse(courseId);
    return this.prisma.course.update({ where: { id: courseId }, data: input });
  }

  async getCourse(courseId: string): Promise<Course> {
    const course = await this.prisma.course.findUnique({ where: { id: courseId } });
    if (!course) throw AppError.notFound('Курс не найден');
    return course;
  }

  // ── Версии ─────────────────────────────────────────────────────────────────

  async getVersionTree(versionId: string): Promise<VersionTree> {
    const version = await this.prisma.courseVersion.findUnique({
      where: { id: versionId },
      include: VERSION_TREE_INCLUDE,
    });
    if (!version) throw AppError.notFound('Версия курса не найдена');
    return version as VersionTree;
  }

  async listVersions(courseId: string): Promise<CourseVersion[]> {
    await this.getCourse(courseId);
    return this.prisma.courseVersion.findMany({
      where: { courseId },
      orderBy: { versionNo: 'desc' },
    });
  }

  async latestPublished(courseId: string): Promise<CourseVersion | null> {
    return this.prisma.courseVersion.findFirst({
      where: { courseId, status: 'published' },
      orderBy: { versionNo: 'desc' },
    });
  }

  async currentDraft(courseId: string): Promise<CourseVersion | null> {
    return this.prisma.courseVersion.findFirst({
      where: { courseId, status: 'draft' },
      orderBy: { versionNo: 'desc' },
    });
  }

  /** Черновик из последней опубликованной версии (или пустой, если её нет). */
  async createDraft(courseId: string): Promise<CourseVersion> {
    await this.getCourse(courseId);
    const existingDraft = await this.currentDraft(courseId);
    if (existingDraft) return existingDraft;

    const source = await this.latestPublished(courseId);
    const maxVersion = await this.prisma.courseVersion.findFirst({
      where: { courseId },
      orderBy: { versionNo: 'desc' },
      select: { versionNo: true },
    });
    const versionNo = (maxVersion?.versionNo ?? 0) + 1;

    if (!source) {
      return this.prisma.courseVersion.create({ data: { courseId, versionNo, status: 'draft' } });
    }
    return this.copyVersion(source.id, courseId, versionNo);
  }

  /** Полная копия структуры версии с сохранением ключей. */
  private async copyVersion(
    sourceVersionId: string,
    courseId: string,
    versionNo: number,
  ): Promise<CourseVersion> {
    const source = await this.getVersionTree(sourceVersionId);

    return this.prisma.transaction(
      async (tx) => {
        const version = await tx.courseVersion.create({
          data: { courseId, versionNo, status: 'draft' },
        });

        for (const stage of source.stages) {
          const createdStage = await tx.stage.create({
            data: {
              courseVersionId: version.id,
              key: stage.key,
              position: stage.position,
              title: stage.title,
              description: stage.description,
              coverFileId: stage.coverFileId,
              unlockDaysOffset: stage.unlockDaysOffset,
              requiresPreviousStage: stage.requiresPreviousStage,
            },
          });

          const lessonIdByKey = new Map<string, string>();
          for (const lesson of stage.lessons) {
            const createdLesson = await tx.lesson.create({
              data: {
                stageId: createdStage.id,
                key: lesson.key,
                position: lesson.position,
                title: lesson.title,
                description: lesson.description,
                isRequired: lesson.isRequired,
                videoAssetId: lesson.videoAssetId,
                minWatchPercent: lesson.minWatchPercent,
                estimatedMinutes: lesson.estimatedMinutes,
              },
            });
            lessonIdByKey.set(lesson.key, createdLesson.id);

            for (const material of lesson.materials) {
              await tx.lessonMaterial.create({
                data: {
                  lessonId: createdLesson.id,
                  position: material.position,
                  kind: material.kind,
                  title: material.title,
                  fileId: material.fileId,
                  url: material.url,
                  body: material.body,
                },
              });
            }
          }

          for (const assignment of stage.assignments) {
            const sourceLessonKey = stage.lessons.find((l) => l.id === assignment.lessonId)?.key;
            await tx.assignment.create({
              data: {
                stageId: createdStage.id,
                lessonId: sourceLessonKey ? (lessonIdByKey.get(sourceLessonKey) ?? null) : null,
                key: assignment.key,
                position: assignment.position,
                title: assignment.title,
                instructions: assignment.instructions,
                isRequired: assignment.isRequired,
                requiredMedia: assignment.requiredMedia as Prisma.InputJsonValue,
                maxVideoSec: assignment.maxVideoSec,
              },
            });
          }

          for (const exam of stage.exams) {
            const createdExam = await tx.exam.create({
              data: {
                stageId: createdStage.id,
                key: exam.key,
                position: exam.position,
                title: exam.title,
                kind: exam.kind,
                description: exam.description,
                passingScore: exam.passingScore,
                maxAttempts: exam.maxAttempts,
                timeLimitSec: exam.timeLimitSec,
                cooldownHours: exam.cooldownHours,
                shuffleQuestions: exam.shuffleQuestions,
                questionsPerAttempt: exam.questionsPerAttempt,
                showExplanations: exam.showExplanations,
                isRequired: exam.isRequired,
              },
            });

            for (const question of exam.questions) {
              const createdQuestion = await tx.question.create({
                data: {
                  examId: createdExam.id,
                  position: question.position,
                  kind: question.kind,
                  body: question.body,
                  imageFileId: question.imageFileId,
                  explanation: question.explanation,
                  points: question.points,
                  acceptedAnswers: question.acceptedAnswers as Prisma.InputJsonValue,
                },
              });
              for (const option of question.options) {
                await tx.questionOption.create({
                  data: {
                    questionId: createdQuestion.id,
                    position: option.position,
                    body: option.body,
                    isCorrect: option.isCorrect,
                  },
                });
              }
            }
          }
        }
        return version;
      },
      { timeoutMs: 60_000 },
    );
  }

  /**
   * Проверка готовности версии к публикации.
   * Возвращает список проблем: интерфейс показывает их списком, а не одной ошибкой.
   */
  async validateForPublish(versionId: string): Promise<PublishIssue[]> {
    const version = await this.getVersionTree(versionId);
    const issues: PublishIssue[] = [];

    if (version.stages.length === 0) {
      issues.push({ path: 'stages', message: 'В курсе нет ни одного этапа' });
    }

    const stageKeys = new Set<string>();
    for (const stage of version.stages) {
      const at = `Этап «${stage.title}»`;
      if (stageKeys.has(stage.key)) {
        issues.push({
          path: `stage:${stage.key}`,
          message: `${at}: ключ «${stage.key}» повторяется`,
        });
      }
      stageKeys.add(stage.key);

      if (stage.lessons.length === 0) {
        issues.push({ path: `stage:${stage.key}`, message: `${at}: нет ни одного урока` });
      }
      if (stage.unlockDaysOffset < 0) {
        issues.push({
          path: `stage:${stage.key}`,
          message: `${at}: отрицательная задержка открытия`,
        });
      }

      for (const lesson of stage.lessons) {
        if (lesson.isRequired && !lesson.videoAssetId) {
          issues.push({
            path: `lesson:${stage.key}/${lesson.key}`,
            message: `${at}, урок «${lesson.title}»: обязательный урок без видео`,
          });
        }
        if (lesson.videoAsset && lesson.videoAsset.status !== 'ready') {
          issues.push({
            path: `lesson:${stage.key}/${lesson.key}`,
            message: `${at}, урок «${lesson.title}»: видео ещё не готово (${lesson.videoAsset.status})`,
          });
        }
        if (lesson.minWatchPercent < 0 || lesson.minWatchPercent > 100) {
          issues.push({
            path: `lesson:${stage.key}/${lesson.key}`,
            message: `${at}, урок «${lesson.title}»: порог просмотра вне диапазона 0–100`,
          });
        }
      }

      for (const assignment of stage.assignments) {
        if (!assignment.instructions.trim()) {
          issues.push({
            path: `assignment:${stage.key}/${assignment.key}`,
            message: `${at}, задание «${assignment.title}»: пустая инструкция`,
          });
        }
      }

      for (const exam of stage.exams) {
        if (exam.passingScore < 0 || exam.passingScore > 100) {
          issues.push({
            path: `exam:${stage.key}/${exam.key}`,
            message: `${at}, экзамен «${exam.title}»: порог прохождения вне диапазона 0–100`,
          });
        }
        if (exam.kind === 'test') {
          if (exam.questions.length === 0) {
            issues.push({
              path: `exam:${stage.key}/${exam.key}`,
              message: `${at}, тест «${exam.title}»: нет вопросов`,
            });
          }
          if (exam.questionsPerAttempt && exam.questionsPerAttempt > exam.questions.length) {
            issues.push({
              path: `exam:${stage.key}/${exam.key}`,
              message: `${at}, тест «${exam.title}»: вопросов в попытке больше, чем в банке`,
            });
          }
          for (const question of exam.questions) {
            if (question.kind === 'short_text') {
              const answers = (question.acceptedAnswers ?? []) as string[];
              if (!Array.isArray(answers) || answers.length === 0) {
                issues.push({
                  path: `question:${exam.key}/${question.position}`,
                  message: `${at}, тест «${exam.title}», вопрос ${question.position}: не заданы принимаемые ответы`,
                });
              }
            } else {
              const correct = question.options.filter((o) => o.isCorrect);
              if (question.options.length < 2) {
                issues.push({
                  path: `question:${exam.key}/${question.position}`,
                  message: `${at}, тест «${exam.title}», вопрос ${question.position}: меньше двух вариантов`,
                });
              }
              if (correct.length === 0) {
                issues.push({
                  path: `question:${exam.key}/${question.position}`,
                  message: `${at}, тест «${exam.title}», вопрос ${question.position}: не отмечен правильный ответ`,
                });
              }
              if (question.kind === 'single' && correct.length > 1) {
                issues.push({
                  path: `question:${exam.key}/${question.position}`,
                  message: `${at}, тест «${exam.title}», вопрос ${question.position}: несколько правильных ответов в вопросе с одним выбором`,
                });
              }
            }
          }
        }
      }
    }

    return issues;
  }

  /**
   * Публикация: версия становится неизменяемой, следом создаётся новый черновик.
   */
  async publish(
    versionId: string,
    publishedById: string,
    changelog?: string | null,
  ): Promise<CourseVersion> {
    const version = await this.prisma.courseVersion.findUnique({ where: { id: versionId } });
    if (!version) throw AppError.notFound('Версия курса не найдена');
    if (version.status !== 'draft') {
      throw new AppError('version_immutable', 'Опубликованную версию нельзя опубликовать повторно');
    }

    const issues = await this.validateForPublish(versionId);
    if (issues.length > 0) {
      throw new AppError('publish_validation_failed', 'Курс не готов к публикации', issues);
    }

    const published = await this.prisma.courseVersion.update({
      where: { id: versionId },
      data: {
        status: 'published',
        publishedAt: new Date(),
        publishedById,
        changelog: changelog ?? null,
      },
    });

    // Следующий черновик — копия только что опубликованной версии.
    await this.createDraft(version.courseId);
    this.logger.log(`Опубликована версия ${published.versionNo} курса ${version.courseId}`);
    return published;
  }

  /** Черновик можно менять, опубликованную версию — нет. */
  async assertDraft(versionId: string): Promise<CourseVersion> {
    const version = await this.prisma.courseVersion.findUnique({ where: { id: versionId } });
    if (!version) throw AppError.notFound('Версия курса не найдена');
    if (version.status !== 'draft') {
      throw new AppError(
        'version_immutable',
        'Опубликованная версия неизменяема. Создайте черновик и работайте в нём',
      );
    }
    return version;
  }

  async versionIdOfStage(stageId: string): Promise<string> {
    const stage = await this.prisma.stage.findUnique({
      where: { id: stageId },
      select: { courseVersionId: true },
    });
    if (!stage) throw AppError.notFound('Этап не найден');
    return stage.courseVersionId;
  }

  async versionIdOfLesson(lessonId: string): Promise<string> {
    const lesson = await this.prisma.lesson.findUnique({
      where: { id: lessonId },
      select: { stage: { select: { courseVersionId: true } } },
    });
    if (!lesson) throw AppError.notFound('Урок не найден');
    return lesson.stage.courseVersionId;
  }

  async versionIdOfExam(examId: string): Promise<string> {
    const exam = await this.prisma.exam.findUnique({
      where: { id: examId },
      select: { stage: { select: { courseVersionId: true } } },
    });
    if (!exam) throw AppError.notFound('Экзамен не найден');
    return exam.stage.courseVersionId;
  }
}
