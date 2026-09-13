import type { PlatformRoleName, PrismaClient, SessionKind } from '@prisma/client';
import { signInitData, signLoginWidget } from '@/infra/telegram/init-data';
import type { TestApp } from './app';

export const TEST_BOT_TOKEN = '123456:TEST-BOT-TOKEN-FOR-INTEGRATION';

let telegramIdCounter = 100_000;

export function nextTelegramId(): number {
  telegramIdCounter += 1;
  return telegramIdCounter;
}

export function makeInitData(
  overrides: Partial<{
    id: number;
    first_name: string;
    last_name: string;
    username: string;
    allows_write_to_pm: boolean;
    start_param: string;
    auth_date: number;
  }> = {},
): string {
  const id = overrides.id ?? nextTelegramId();
  const fields: Record<string, string> = {
    auth_date: String(overrides.auth_date ?? Math.floor(Date.now() / 1000)),
    user: JSON.stringify({
      id,
      first_name: overrides.first_name ?? 'Тест',
      last_name: overrides.last_name ?? 'Пользователь',
      username: overrides.username ?? `user${id}`,
      language_code: 'ru',
      allows_write_to_pm: overrides.allows_write_to_pm ?? true,
    }),
  };
  if (overrides.start_param) fields.start_param = overrides.start_param;
  return signInitData(fields, TEST_BOT_TOKEN);
}

export function makeWidgetData(
  overrides: Partial<{ id: number; first_name: string; username: string; auth_date: number }> = {},
): Record<string, string | number> {
  return signLoginWidget(
    {
      id: overrides.id ?? nextTelegramId(),
      first_name: overrides.first_name ?? 'Админ',
      username: overrides.username ?? 'admin',
      auth_date: overrides.auth_date ?? Math.floor(Date.now() / 1000),
    },
    TEST_BOT_TOKEN,
  );
}

export interface TestUser {
  id: string;
  telegramUserId: number;
  accessToken: string;
  refreshToken: string;
  authHeader: [string, string];
}

/** Создаёт пользователя и выдаёт ему действующую сессию напрямую через сервисы. */
export async function createUser(
  ctx: TestApp,
  options: {
    telegramUserId?: number;
    firstName?: string;
    username?: string;
    platformRoles?: PlatformRoleName[];
    kind?: SessionKind;
  } = {},
): Promise<TestUser> {
  const telegramUserId = options.telegramUserId ?? nextTelegramId();
  const user = await ctx.prisma.user.create({
    data: {
      telegramUserId: BigInt(telegramUserId),
      firstName: options.firstName ?? 'Тест',
      username: options.username ?? `user${telegramUserId}`,
      botWriteAllowed: true,
    },
  });

  for (const role of options.platformRoles ?? []) {
    await ctx.prisma.platformRole.create({ data: { userId: user.id, role } });
  }

  const { SessionService } = await import('@/modules/auth/session.service');
  const sessions = ctx.app.get(SessionService);
  const issued = await sessions.issue(user.id, options.kind ?? 'miniapp');

  return {
    id: user.id,
    telegramUserId,
    accessToken: issued.accessToken,
    refreshToken: issued.refreshToken,
    authHeader: ['Authorization', `Bearer ${issued.accessToken}`],
  };
}

export async function countRows(prisma: PrismaClient, table: string): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
    `SELECT count(*)::bigint as count FROM "public"."${table}"`,
  );
  return Number(rows[0]?.count ?? 0);
}

export interface TestWorkspace {
  id: string;
  ownerMemberId: string;
  grantId: string | null;
}

/** Мастерская с владельцем и, по умолчанию, действующим доступом к CRM. */
export async function createWorkspace(
  ctx: TestApp,
  options: {
    ownerUserId: string;
    name?: string;
    timezone?: string;
    withAccess?: boolean;
    validUntil?: Date | null;
    settings?: Record<string, unknown>;
  },
): Promise<TestWorkspace> {
  const workspace = await ctx.prisma.workspace.create({
    data: {
      name: options.name ?? 'Мастерская',
      timezone: options.timezone ?? 'Europe/Moscow',
      currency: 'RUB',
      createdById: options.ownerUserId,
      settings: (options.settings ?? {}) as object,
    },
  });
  const member = await ctx.prisma.workspaceMember.create({
    data: { workspaceId: workspace.id, userId: options.ownerUserId, role: 'owner' },
  });

  let grantId: string | null = null;
  if (options.withAccess !== false) {
    const grant = await ctx.prisma.accessGrant.create({
      data: {
        product: 'crm',
        subjectType: 'workspace',
        workspaceId: workspace.id,
        status: 'active',
        validFrom: new Date(Date.now() - 86_400_000),
        validUntil: options.validUntil ?? null,
        grantedById: options.ownerUserId,
      },
    });
    grantId = grant.id;
  }

  return { id: workspace.id, ownerMemberId: member.id, grantId };
}

export async function addEmployee(
  ctx: TestApp,
  workspaceId: string,
  userId: string,
): Promise<string> {
  const member = await ctx.prisma.workspaceMember.create({
    data: { workspaceId, userId, role: 'employee' },
  });
  return member.id;
}

export interface ExamSpec {
  key: string;
  title: string;
  kind: 'test' | 'practical';
  passingScore: number;
  maxAttempts?: number | null;
  timeLimitSec?: number | null;
  cooldownHours?: number;
  questionsPerAttempt?: number | null;
  shuffle?: boolean;
  questions?: {
    body: string;
    kind?: 'single' | 'multiple' | 'boolean' | 'short_text';
    points?: number;
    options?: [string, boolean][];
    acceptedAnswers?: string[];
  }[];
}

export interface AssignmentSpec {
  key: string;
  title: string;
  minPhotos?: number;
  minVideos?: number;
  textRequired?: boolean;
}

export interface TestCourse {
  courseId: string;
  versionId: string;
  cohortId: string;
  stageKeys: string[];
}

/**
 * Опубликованный курс из нескольких этапов и группа на нём.
 * Каждый этап: один обязательный урок с готовым видео.
 */
export async function createPublishedCourse(
  ctx: TestApp,
  options: {
    adminId: string;
    stages?: {
      key: string;
      title: string;
      unlockDaysOffset: number;
      lessons?: string[];
      assignments?: AssignmentSpec[];
      exams?: ExamSpec[];
    }[];
    unlockMode?: 'interval' | 'dates';
    cohortStartsAt?: Date;
    stageDates?: Record<string, string>;
  },
): Promise<TestCourse> {
  const stages = options.stages ?? [
    { key: 'stage-1', title: 'База', unlockDaysOffset: 0, lessons: ['light'] },
    { key: 'stage-2', title: 'Сложное', unlockDaysOffset: 30, lessons: ['hail'] },
    { key: 'stage-3', title: 'Самостоятельно', unlockDaysOffset: 60, lessons: ['estimate'] },
  ];

  const course = await ctx.prisma.course.create({
    data: {
      slug: `course-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      title: 'Тестовый курс',
    },
  });
  const version = await ctx.prisma.courseVersion.create({
    data: {
      courseId: course.id,
      versionNo: 1,
      status: 'published',
      publishedAt: new Date(),
      publishedById: options.adminId,
    },
  });

  for (const [index, stage] of stages.entries()) {
    const createdStage = await ctx.prisma.stage.create({
      data: {
        courseVersionId: version.id,
        key: stage.key,
        position: index + 1,
        title: stage.title,
        unlockDaysOffset: stage.unlockDaysOffset,
        requiresPreviousStage: true,
      },
    });
    for (const [examIndex, spec] of (stage.exams ?? []).entries()) {
      const exam = await ctx.prisma.exam.create({
        data: {
          stageId: createdStage.id,
          key: spec.key,
          position: examIndex + 1,
          title: spec.title,
          kind: spec.kind,
          passingScore: spec.passingScore,
          maxAttempts: spec.maxAttempts ?? null,
          timeLimitSec: spec.timeLimitSec ?? null,
          cooldownHours: spec.cooldownHours ?? 0,
          questionsPerAttempt: spec.questionsPerAttempt ?? null,
          shuffleQuestions: spec.shuffle ?? false,
          isRequired: true,
        },
      });
      for (const [questionIndex, question] of (spec.questions ?? []).entries()) {
        const created = await ctx.prisma.question.create({
          data: {
            examId: exam.id,
            position: questionIndex + 1,
            kind: question.kind ?? 'single',
            body: question.body,
            points: question.points ?? 1,
            acceptedAnswers: question.acceptedAnswers ?? undefined,
          },
        });
        for (const [optionIndex, [body, isCorrect]] of (question.options ?? []).entries()) {
          await ctx.prisma.questionOption.create({
            data: { questionId: created.id, position: optionIndex + 1, body, isCorrect },
          });
        }
      }
    }

    for (const [assignmentIndex, assignment] of (stage.assignments ?? []).entries()) {
      await ctx.prisma.assignment.create({
        data: {
          stageId: createdStage.id,
          key: assignment.key,
          position: assignmentIndex + 1,
          title: assignment.title,
          instructions: 'Выполните работу и приложите фотографии.',
          isRequired: true,
          requiredMedia: {
            min_photos: assignment.minPhotos ?? 1,
            min_videos: assignment.minVideos ?? 0,
            text_required: assignment.textRequired ?? false,
          },
        },
      });
    }

    for (const [lessonIndex, lessonKey] of (stage.lessons ?? ['lesson-1']).entries()) {
      const video = await ctx.prisma.videoAsset.create({
        data: {
          provider: 'mock',
          providerVideoId: `v-${stage.key}-${lessonKey}-${Math.random().toString(36).slice(2, 8)}`,
          title: lessonKey,
          status: 'ready',
          durationSec: 600,
        },
      });
      await ctx.prisma.lesson.create({
        data: {
          stageId: createdStage.id,
          key: lessonKey,
          position: lessonIndex + 1,
          title: lessonKey,
          isRequired: true,
          videoAssetId: video.id,
        },
      });
    }
  }

  // Черновик следующей версии, как это делает публикация в редакторе.
  await ctx.prisma.courseVersion.create({
    data: { courseId: course.id, versionNo: 2, status: 'draft' },
  });

  const cohort = await ctx.prisma.cohort.create({
    data: {
      courseId: course.id,
      courseVersionId: version.id,
      title: 'Поток 1',
      unlockMode: options.unlockMode ?? 'interval',
      startsAt: options.cohortStartsAt ?? new Date(),
      stageDates: options.stageDates ?? undefined,
    },
  });

  return {
    courseId: course.id,
    versionId: version.id,
    cohortId: cohort.id,
    stageKeys: stages.map((s) => s.key),
  };
}

/** Зачисление ученика с действующим доступом к курсу. */
export async function enrollStudent(
  ctx: TestApp,
  input: {
    cohortId: string;
    courseId: string;
    userId: string;
    grantedById: string;
    startedAt?: Date;
    grantValidUntil?: Date | null;
  },
): Promise<string> {
  const grant = await ctx.prisma.accessGrant.create({
    data: {
      product: 'course',
      subjectType: 'user',
      userId: input.userId,
      courseId: input.courseId,
      status: 'active',
      validFrom: new Date(Date.now() - 86_400_000),
      validUntil: input.grantValidUntil ?? null,
      grantedById: input.grantedById,
    },
  });
  const enrollment = await ctx.prisma.enrollment.create({
    data: {
      cohortId: input.cohortId,
      userId: input.userId,
      accessGrantId: grant.id,
      startedAt: input.startedAt ?? new Date(),
      status: 'active',
    },
  });
  return enrollment.id;
}

/** Загруженный и обработанный файл работы ученика. */
export async function createReadySubmissionFile(
  ctx: TestApp,
  ownerUserId: string,
  mimeType = 'image/jpeg',
): Promise<string> {
  const file = await ctx.prisma.storedFile.create({
    data: {
      ownerUserId,
      scope: 'submission',
      storageKey: `submission/${ownerUserId}/${Math.random().toString(36).slice(2)}.jpg`,
      bucket: 'test',
      mimeType,
      sizeBytes: BigInt(1024),
      status: 'ready',
      variants: { thumb: 'thumb-key' },
    },
  });
  return file.id;
}

/** Файл, приложенный к практическому экзамену. */
export async function createReadyAttemptFile(ctx: TestApp, ownerUserId: string): Promise<string> {
  const file = await ctx.prisma.storedFile.create({
    data: {
      ownerUserId,
      scope: 'exam_attempt',
      storageKey: `exam_attempt/${ownerUserId}/${Math.random().toString(36).slice(2)}.jpg`,
      bucket: 'test',
      mimeType: 'image/jpeg',
      sizeBytes: BigInt(2048),
      status: 'ready',
      variants: { thumb: 'thumb-key' },
    },
  });
  return file.id;
}
