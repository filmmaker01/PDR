/**
 * Демонстрационные данные staging.
 *
 * Цель: после входа ни один экран не пустой — видно курс с прогрессом,
 * очередь куратора, мастерскую с заказами в разных статусах, календарь,
 * сметы, оплаты, фотографии и аналитику за два месяца.
 *
 * Скрипт пересоздаёт данные целиком и поэтому запрещён в production.
 * Запуск: pnpm --filter @pdr/api seed:staging
 */
import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { PrismaClient, type Prisma } from '@prisma/client';
import { DEFAULT_EXTRA_WORKS, todayInZone, zonedTimeToUtc } from '@pdr/shared';
import sharp from 'sharp';

const prisma = new PrismaClient();

const STORAGE_DIR = resolve(process.cwd(), process.env.STORAGE_LOCAL_DIR ?? './storage-local');
const BUCKET = process.env.S3_BUCKET ?? 'pdr-local';

const DAY = 86_400_000;
const now = Date.now();
const daysAgo = (days: number): Date => new Date(now - days * DAY);
const daysAhead = (days: number): Date => new Date(now + days * DAY);
const minor = (rubles: number): bigint => BigInt(Math.round(rubles * 100));

/** Telegram-идентификаторы демо-аккаунтов: зарезервированный диапазон. */
let nextTelegramId = 900_000_001;

interface DemoUserInput {
  key: string;
  firstName: string;
  lastName?: string;
  username: string;
  platformRole?: 'admin' | 'curator';
}

async function createUser(input: DemoUserInput): Promise<string> {
  const user = await prisma.user.create({
    data: {
      telegramUserId: BigInt(nextTelegramId++),
      firstName: input.firstName,
      lastName: input.lastName ?? null,
      username: input.username,
      demoKey: input.key,
      botWriteAllowed: true,
      phone: `+7900000${String(nextTelegramId).slice(-4)}`,
    },
  });
  if (input.platformRole) {
    await prisma.platformRole.create({ data: { userId: user.id, role: input.platformRole } });
  }
  return user.id;
}

/**
 * Картинка-заглушка вместо фотографии ремонта: демо-данные не должны
 * тянуть за собой чужие снимки, а пустая галерея ничего не показывает.
 */
async function createPhotoFile(input: {
  ownerUserId: string;
  workspaceId: string;
  label: string;
  color: string;
}): Promise<string> {
  const fileId = randomUUID();
  const key = `order_photo/${input.workspaceId}/${new Date().getUTCFullYear()}/demo/${fileId}.jpg`;
  const thumbKey = key.replace('.jpg', '_thumb.jpg');

  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900">
       <rect width="1200" height="900" fill="${input.color}"/>
       <text x="600" y="460" text-anchor="middle" font-family="sans-serif" font-size="72" fill="#ffffff">${input.label}</text>
       <text x="600" y="540" text-anchor="middle" font-family="sans-serif" font-size="36" fill="#ffffffcc">демонстрационное фото</text>
     </svg>`,
  );

  const original = await sharp(svg).jpeg({ quality: 80 }).toBuffer();
  const thumb = await sharp(original)
    .resize(320, 240, { fit: 'cover' })
    .jpeg({ quality: 70 })
    .toBuffer();

  for (const [objectKey, body] of [
    [key, original],
    [thumbKey, thumb],
  ] as const) {
    const path = join(STORAGE_DIR, objectKey);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }

  await prisma.storedFile.create({
    data: {
      id: fileId,
      ownerUserId: input.ownerUserId,
      workspaceId: input.workspaceId,
      scope: 'order_photo',
      storageKey: key,
      bucket: BUCKET,
      mimeType: 'image/jpeg',
      sizeBytes: BigInt(original.length),
      originalName: `${input.label}.jpg`,
      status: 'ready',
      width: 1200,
      height: 900,
      variants: { thumb: thumbKey } as Prisma.InputJsonValue,
    },
  });

  return fileId;
}

async function wipe(): Promise<void> {
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'
  `;
  if (rows.length === 0) return;
  const list = rows.map((r) => `"public"."${r.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);

  // Файлы удаляются вместе с записями: иначе каталог хранилища растёт от
  // пересева к пересеву мёртвыми снимками, на которые уже никто не ссылается.
  await rm(join(STORAGE_DIR, 'order_photo'), { recursive: true, force: true });
  await rm(join(STORAGE_DIR, 'submission'), { recursive: true, force: true });
}

// ── Курс ─────────────────────────────────────────────────────────────────────

interface StageSpec {
  key: string;
  title: string;
  offset: number;
  lessons: { key: string; title: string; minutes: number }[];
  assignment?: { key: string; title: string; minPhotos: number; minVideos?: number };
  exams?: {
    key: string;
    title: string;
    kind: 'test' | 'practical';
    questions?: { body: string; options: [string, boolean][] }[];
  }[];
}

const STAGES: StageSpec[] = [
  {
    key: 'stage-1',
    title: 'База PDR',
    offset: 0,
    lessons: [
      { key: 'intro', title: 'Что такое PDR и когда он применим', minutes: 12 },
      { key: 'tools', title: 'Инструмент: крючки, насадки, свет', minutes: 18 },
      { key: 'first-dent', title: 'Первая вмятина: подход и давление', minutes: 24 },
    ],
    assignment: {
      key: 'practice-1',
      title: 'Первая вмятина на тренировочной панели',
      minPhotos: 2,
    },
    exams: [
      {
        key: 'test-1',
        title: 'Тест по базе',
        kind: 'test',
        questions: [
          {
            body: 'С чего начинается работа с вмятиной?',
            options: [
              ['С оценки доступа и постановки света', true],
              ['С нагрева феном', false],
              ['С покраски элемента', false],
            ],
          },
          {
            body: 'Что означает размерный класс S в прайсе мастерской?',
            options: [
              ['Вмятина до 2 см', true],
              ['Вмятина до 10 см', false],
              ['Вмятина на ребре', false],
            ],
          },
          {
            body: 'Можно ли выправить вмятину с повреждением лакокрасочного покрытия методом PDR?',
            options: [
              ['Нет, требуется окраска', true],
              ['Да, всегда', false],
              ['Да, если вмятина маленькая', false],
            ],
          },
        ],
      },
    ],
  },
  {
    key: 'stage-2',
    title: 'Град и сложные вмятины',
    offset: 14,
    lessons: [
      {
        key: 'hail-theory',
        title: 'Градовые повреждения: как считать и как планировать',
        minutes: 20,
      },
      { key: 'hail-practice', title: 'Крыша и капот после града', minutes: 28 },
    ],
    assignment: {
      key: 'practice-2',
      title: 'Градовая панель: 10 вмятин',
      minPhotos: 3,
      minVideos: 1,
    },
    exams: [
      {
        key: 'exam-practical-2',
        title: 'Практический экзамен: град',
        kind: 'practical',
      },
    ],
  },
  {
    key: 'stage-3',
    title: 'Клиент, смета и деньги',
    offset: 30,
    lessons: [
      { key: 'estimate', title: 'Как составить смету и обосновать цену', minutes: 22 },
      { key: 'client-talk', title: 'Разговор с клиентом и согласование', minutes: 16 },
    ],
    exams: [
      {
        key: 'test-final',
        title: 'Итоговый тест',
        kind: 'test',
        questions: [
          {
            body: 'Что делать, если при разборке обнаружено скрытое повреждение?',
            options: [
              ['Согласовать новую версию сметы', true],
              ['Молча доделать и выставить счёт', false],
              ['Отказаться от заказа', false],
            ],
          },
          {
            body: 'Когда фиксируется согласованная сумма заказа?',
            options: [
              ['При согласовании сметы клиентом', true],
              ['При выдаче автомобиля', false],
              ['При записи на приём', false],
            ],
          },
        ],
      },
    ],
  },
];

async function seedCourse(adminId: string): Promise<{
  courseId: string;
  versionId: string;
  stageIds: Record<string, string>;
}> {
  const course = await prisma.course.create({
    data: { slug: 'pdr-base', title: 'PDR с нуля до мастера', isActive: true },
  });

  const version = await prisma.courseVersion.create({
    data: {
      courseId: course.id,
      versionNo: 1,
      status: 'published',
      publishedAt: daysAgo(60),
      publishedById: adminId,
      changelog: 'Первая публикация: три этапа, практика и экзамены.',
    },
  });

  const stageIds: Record<string, string> = {};

  for (const [index, spec] of STAGES.entries()) {
    const stage = await prisma.stage.create({
      data: {
        courseVersionId: version.id,
        key: spec.key,
        title: spec.title,
        description: `${spec.lessons.length} ${pluralRu(spec.lessons.length, ['урок', 'урока', 'уроков'])}, практика и проверка знаний.`,
        position: index + 1,
        unlockDaysOffset: spec.offset,
        requiresPreviousStage: true,
      },
    });
    stageIds[spec.key] = stage.id;

    for (const [lessonIndex, lesson] of spec.lessons.entries()) {
      const video = await prisma.videoAsset.create({
        data: {
          provider: 'mock',
          providerVideoId: `demo-${spec.key}-${lesson.key}`,
          title: lesson.title,
          status: 'ready',
          durationSec: lesson.minutes * 60,
          uploadedById: adminId,
        },
      });

      await prisma.lesson.create({
        data: {
          stageId: stage.id,
          key: lesson.key,
          title: lesson.title,
          position: lessonIndex + 1,
          isRequired: true,
          videoAssetId: video.id,
          // Порог просмотра в демо-данных снят: плеер-заглушка отсчитывает
          // время в реальном темпе, и «посмотреть 70%» означало бы семь минут
          // ожидания на каждом уроке. В рабочем курсе порог задаётся
          // в редакторе этапа и работает по событиям плеера.
          minWatchPercent: 0,
          estimatedMinutes: lesson.minutes,
          description: `Конспект урока «${lesson.title}». В демо-данных текст сокращён.`,
        },
      });
    }

    if (spec.assignment) {
      await prisma.assignment.create({
        data: {
          stageId: stage.id,
          key: spec.assignment.key,
          title: spec.assignment.title,
          position: 1,
          instructions:
            'Снимите повреждение до работы, процесс и результат. Опишите, какой инструмент использовали и что было сложным.',
          requiredMedia: {
            min_photos: spec.assignment.minPhotos,
            min_videos: spec.assignment.minVideos ?? 0,
            text_required: true,
          } as Prisma.InputJsonValue,
          isRequired: true,
        },
      });
    }

    for (const [examIndex, exam] of (spec.exams ?? []).entries()) {
      const created = await prisma.exam.create({
        data: {
          stageId: stage.id,
          key: exam.key,
          title: exam.title,
          kind: exam.kind,
          position: examIndex + 1,
          passingScore: 70,
          maxAttempts: exam.kind === 'test' ? 3 : null,
          cooldownHours: exam.kind === 'test' ? 12 : 0,
          timeLimitSec: exam.kind === 'test' ? 900 : null,
          isRequired: true,
          description:
            exam.kind === 'practical'
              ? 'Выправьте градовую панель и снимите результат с трёх ракурсов.'
              : 'Три вопроса, порог 70%, три попытки.',
        },
      });

      for (const [questionIndex, question] of (exam.questions ?? []).entries()) {
        const createdQuestion = await prisma.question.create({
          data: {
            examId: created.id,
            kind: 'single',
            body: question.body,
            position: questionIndex + 1,
            points: 1,
          },
        });
        for (const [optionIndex, [text, correct]] of question.options.entries()) {
          await prisma.questionOption.create({
            data: {
              questionId: createdQuestion.id,
              body: text,
              isCorrect: correct,
              position: optionIndex + 1,
            },
          });
        }
      }
    }
  }

  return { courseId: course.id, versionId: version.id, stageIds };
}

// ── Ученики и прогресс ───────────────────────────────────────────────────────

async function seedLearning(input: {
  adminId: string;
  curatorId: string;
  studentId: string;
  newStudentId: string;
  courseId: string;
  versionId: string;
}): Promise<void> {
  const cohort = await prisma.cohort.create({
    data: {
      courseId: input.courseId,
      courseVersionId: input.versionId,
      title: 'Поток «Осень»',
      unlockMode: 'interval',
      startsAt: daysAgo(40),
      isActive: true,
    },
  });

  await prisma.cohortCurator.create({ data: { cohortId: cohort.id, userId: input.curatorId } });

  const enroll = async (userId: string, startedDaysAgo: number): Promise<string> => {
    const grant = await prisma.accessGrant.create({
      data: {
        product: 'course',
        subjectType: 'user',
        userId,
        courseId: input.courseId,
        status: 'active',
        validFrom: daysAgo(startedDaysAgo),
        validUntil: daysAhead(120),
        grantedById: input.adminId,
        reason: 'Демонстрационный доступ',
      },
    });
    const enrollment = await prisma.enrollment.create({
      data: {
        cohortId: cohort.id,
        userId,
        accessGrantId: grant.id,
        startedAt: daysAgo(startedDaysAgo),
        status: 'active',
      },
    });
    return enrollment.id;
  };

  const enrollmentId = await enroll(input.studentId, 20);
  await enroll(input.newStudentId, 0);

  // Первый этап пройден полностью.
  for (const lesson of STAGES[0]!.lessons) {
    await prisma.lessonProgress.create({
      data: {
        enrollmentId,
        lessonKey: lesson.key,
        watchPercent: 100,
        watchPositionSec: lesson.minutes * 60,
        completedAt: daysAgo(16),
        firstOpenedAt: daysAgo(19),
        lastOpenedAt: daysAgo(16),
      },
    });
  }

  const submissionFile = async (label: string): Promise<string> => {
    const fileId = randomUUID();
    const key = `submission/${input.studentId}/demo/${fileId}.jpg`;
    const body = await sharp(
      Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="700">
           <rect width="900" height="700" fill="#3a4a5a"/>
           <text x="40" y="380" font-family="sans-serif" font-size="48" fill="#fff">${label}</text>
         </svg>`,
      ),
    )
      .jpeg({ quality: 80 })
      .toBuffer();
    const path = join(STORAGE_DIR, key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);

    await prisma.storedFile.create({
      data: {
        id: fileId,
        ownerUserId: input.studentId,
        scope: 'submission',
        storageKey: key,
        bucket: BUCKET,
        mimeType: 'image/jpeg',
        sizeBytes: BigInt(body.length),
        originalName: `${label}.jpg`,
        status: 'ready',
        width: 900,
        height: 700,
      },
    });
    return fileId;
  };

  // Первая попытка возвращена куратором, вторая принята.
  const returned = await prisma.submission.create({
    data: {
      enrollmentId,
      assignmentKey: 'practice-1',
      attemptNo: 1,
      status: 'returned',
      text: 'Выправил вмятину крючком, снизу подошёл через технологическое отверстие.',
      submittedAt: daysAgo(15),
      reviewedAt: daysAgo(14),
    },
  });
  await prisma.submissionFile.create({
    data: { submissionId: returned.id, fileId: await submissionFile('Попытка 1'), position: 1 },
  });
  await prisma.review.create({
    data: {
      submissionId: returned.id,
      reviewerId: input.curatorId,
      decision: 'returned',
      comment: 'Виден след от крючка по краю вмятины. Пройдите рихтовку мягче и пришлите ещё раз.',
      createdAt: daysAgo(14),
    },
  });

  const accepted = await prisma.submission.create({
    data: {
      enrollmentId,
      assignmentKey: 'practice-1',
      attemptNo: 2,
      status: 'accepted',
      text: 'Переделал: работал меньшим давлением, поверхность ровная под лампой.',
      submittedAt: daysAgo(13),
      reviewedAt: daysAgo(12),
    },
  });
  for (const [index, label] of ['До', 'После'].entries()) {
    await prisma.submissionFile.create({
      data: { submissionId: accepted.id, fileId: await submissionFile(label), position: index + 1 },
    });
  }
  await prisma.review.create({
    data: {
      submissionId: accepted.id,
      reviewerId: input.curatorId,
      decision: 'accepted',
      comment: 'Принято. Поверхность ровная, следов инструмента нет.',
      createdAt: daysAgo(12),
    },
  });

  // Тест первого этапа сдан.
  const testExam = await prisma.exam.findFirstOrThrow({ where: { key: 'test-1' } });
  await prisma.examAttempt.create({
    data: {
      enrollmentId,
      examId: testExam.id,
      examKey: 'test-1',
      attemptNo: 1,
      status: 'graded',
      startedAt: daysAgo(12),
      submittedAt: daysAgo(12),
      gradedAt: daysAgo(12),
      score: 3,
      maxScore: 3,
      percent: 100,
      passed: true,
    },
  });

  await prisma.stageCompletion.create({
    data: { enrollmentId, stageKey: 'stage-1', completedAt: daysAgo(12) },
  });

  // Второй этап в работе: урок начат, работа ждёт проверки.
  await prisma.lessonProgress.create({
    data: {
      enrollmentId,
      lessonKey: 'hail-theory',
      watchPercent: 100,
      watchPositionSec: 20 * 60,
      completedAt: daysAgo(4),
      firstOpenedAt: daysAgo(5),
      lastOpenedAt: daysAgo(4),
    },
  });
  await prisma.lessonProgress.create({
    data: {
      enrollmentId,
      lessonKey: 'hail-practice',
      watchPercent: 42,
      watchPositionSec: 12 * 60,
      firstOpenedAt: daysAgo(2),
      lastOpenedAt: daysAgo(1),
    },
  });

  const waiting = await prisma.submission.create({
    data: {
      enrollmentId,
      assignmentKey: 'practice-2',
      attemptNo: 1,
      status: 'submitted',
      text: 'Градовая панель: 12 вмятин, работал с торца крыши. Видео процесса приложил.',
      submittedAt: daysAgo(1),
    },
  });
  for (const [index, label] of ['Град: до', 'Град: процесс', 'Град: после'].entries()) {
    await prisma.submissionFile.create({
      data: { submissionId: waiting.id, fileId: await submissionFile(label), position: index + 1 },
    });
  }

  // Практический экзамен ждёт оценки куратора.
  const practical = await prisma.exam.findFirstOrThrow({ where: { key: 'exam-practical-2' } });
  await prisma.examAttempt.create({
    data: {
      enrollmentId,
      examId: practical.id,
      examKey: 'exam-practical-2',
      attemptNo: 1,
      status: 'submitted',
      startedAt: daysAgo(1),
      submittedAt: daysAgo(1),
    },
  });

  // Уведомления, которые ученик уже получил.
  await prisma.notification.createMany({
    data: [
      {
        userId: input.studentId,
        type: 'review_result',
        payload: {
          decision: 'accepted',
          assignmentTitle: 'Первая вмятина',
        } as Prisma.InputJsonValue,
        status: 'sent',
        dedupeKey: `demo:review:${randomUUID()}`,
        scheduledAt: daysAgo(12),
        sentAt: daysAgo(12),
      },
      {
        userId: input.studentId,
        type: 'stage_unlocked',
        payload: { stageTitle: 'Этап 2. Град и сложные вмятины' } as Prisma.InputJsonValue,
        status: 'sent',
        dedupeKey: `demo:stage:${randomUUID()}`,
        scheduledAt: daysAgo(12),
        sentAt: daysAgo(12),
      },
    ],
  });
}

// ── Мастерская ───────────────────────────────────────────────────────────────

const CLIENTS = [
  { name: 'Иван Петров', phone: '+79161234501', source: 'Рекомендация' },
  { name: 'Мария Соколова', phone: '+79161234502', source: 'Instagram' },
  { name: 'Алексей Крылов', phone: '+79161234503', source: 'Авито' },
  { name: 'Ольга Дмитриева', phone: '+79161234504', source: 'Рекомендация' },
  { name: 'Николай Захаров', phone: '+79161234505', source: 'Карты' },
  { name: 'Екатерина Белова', phone: '+79161234506', source: 'Instagram' },
  { name: 'Сергей Тимофеев', phone: '+79161234507', source: 'Повторный' },
  { name: 'Роман Гусев', phone: '+79161234508', source: 'Дилер' },
];

const VEHICLES = [
  { make: 'Toyota', model: 'Camry', year: 2019, color: 'чёрный', plate: 'А123ВС777' },
  { make: 'Kia', model: 'Rio', year: 2021, color: 'белый', plate: 'В456ОР799' },
  { make: 'Volkswagen', model: 'Tiguan', year: 2018, color: 'серый', plate: 'Е789КХ750' },
  { make: 'Hyundai', model: 'Solaris', year: 2020, color: 'синий', plate: 'К321МН197' },
  { make: 'Skoda', model: 'Octavia', year: 2017, color: 'серебристый', plate: 'М654ТУ177' },
  { make: 'BMW', model: 'X5', year: 2022, color: 'чёрный', plate: 'О987РС777' },
  { make: 'Lada', model: 'Vesta', year: 2021, color: 'красный', plate: 'Т147УХ790' },
  { make: 'Mazda', model: 'CX-5', year: 2019, color: 'бордовый', plate: 'У258ХА197' },
  { make: 'Renault', model: 'Duster', year: 2016, color: 'зелёный', plate: 'Х369АВ750' },
  { make: 'Mercedes-Benz', model: 'E-class', year: 2020, color: 'белый', plate: 'С741ЕК777' },
];

/**
 * Тестовый прайс для настройки формулы клиентом.
 *
 * Размерная сетка заполнена целиком: мастер выбирает 40×40, 40×60, 60×60 и
 * сразу видит, как меняется стоимость. Значения условные — это заготовка под
 * обкатку расчёта, а не коммерческий прайс мастерской.
 *
 * Позиции без размера привязаны к типу повреждения: град считается за элемент,
 * а не за зону, и размер на него не влияет. Какая строка прайса сработала,
 * видно в расчёте — расчёт не должен быть чёрным ящиком.
 */
type PriceSpec = {
  title: string;
  price: number;
  panel: string | null;
  size: string | null;
  type?: string | null;
  kind?: 'damage' | 'disassembly' | 'extra';
};

const PRICE_LIST: PriceSpec[] = [
  { title: 'Вмятина S — до 2 см', price: 1500, panel: null, size: 'S' },
  { title: 'Вмятина M — 2–5 см', price: 2500, panel: null, size: 'M' },
  { title: 'Вмятина L — 5–10 см', price: 4000, panel: null, size: 'L' },
  { title: 'Вмятина XL — 10–20 см', price: 6000, panel: null, size: 'XL' },
  { title: 'Зона 20×40 см', price: 7000, panel: null, size: '20x40' },
  { title: 'Зона 40×40 см', price: 9000, panel: null, size: '40x40' },
  { title: 'Зона 40×60 см', price: 12000, panel: null, size: '40x60' },
  { title: 'Зона 60×60 см', price: 15000, panel: null, size: '60x60' },
  { title: 'Зона 60×100 см', price: 22000, panel: null, size: '60x100' },
  { title: 'Зона 100×100 см', price: 30000, panel: null, size: '100x100' },
  { title: 'Капот, град (за элемент)', price: 12000, panel: 'hood', size: null, type: 'hail' },
  { title: 'Крыша, град (за элемент)', price: 15000, panel: 'roof', size: null, type: 'hail' },
  {
    title: 'Крышка багажника, град (за элемент)',
    price: 10000,
    panel: 'trunk_lid',
    size: null,
    type: 'hail',
  },
  { title: 'Полировка элемента после ремонта', price: 2000, panel: null, size: null, kind: 'extra' },
];

interface OrderSpec {
  clientIndex: number;
  vehicleIndex: number;
  title: string;
  status:
    'new' | 'pending_approval' | 'scheduled' | 'in_progress' | 'ready' | 'delivered' | 'cancelled';
  createdDaysAgo: number;
  estimateRubles?: number;
  paid?: { rubles: number; daysAgo: number; purpose: 'prepayment' | 'payment' | 'final' }[];
  assignee?: 'owner' | 'employee';
  withPhotos?: boolean;
  cancelReason?: string;
}

const ORDERS: OrderSpec[] = [
  {
    clientIndex: 0,
    vehicleIndex: 0,
    title: 'Град на капоте и крыше',
    status: 'delivered',
    createdDaysAgo: 48,
    estimateRubles: 27000,
    paid: [
      { rubles: 10000, daysAgo: 46, purpose: 'prepayment' },
      { rubles: 17000, daysAgo: 42, purpose: 'final' },
    ],
    assignee: 'owner',
    withPhotos: true,
  },
  {
    clientIndex: 1,
    vehicleIndex: 1,
    title: 'Парковочная вмятина на двери',
    status: 'delivered',
    createdDaysAgo: 35,
    estimateRubles: 4500,
    paid: [{ rubles: 4500, daysAgo: 33, purpose: 'payment' }],
    assignee: 'employee',
  },
  {
    clientIndex: 2,
    vehicleIndex: 2,
    title: 'Вмятина на крыле после ворот',
    status: 'delivered',
    createdDaysAgo: 26,
    estimateRubles: 9000,
    paid: [{ rubles: 5000, daysAgo: 24, purpose: 'prepayment' }],
    assignee: 'owner',
    withPhotos: true,
  },
  {
    clientIndex: 3,
    vehicleIndex: 3,
    title: 'Три вмятины на боковине',
    status: 'delivered',
    createdDaysAgo: 18,
    estimateRubles: 7500,
    paid: [{ rubles: 7500, daysAgo: 16, purpose: 'payment' }],
    assignee: 'employee',
  },
  {
    clientIndex: 4,
    vehicleIndex: 4,
    title: 'Град, лёгкая степень',
    status: 'ready',
    createdDaysAgo: 6,
    estimateRubles: 18000,
    paid: [{ rubles: 9000, daysAgo: 5, purpose: 'prepayment' }],
    assignee: 'owner',
    withPhotos: true,
  },
  {
    clientIndex: 5,
    vehicleIndex: 5,
    title: 'Вмятина на двери, алюминий',
    status: 'in_progress',
    createdDaysAgo: 3,
    estimateRubles: 11000,
    paid: [{ rubles: 5000, daysAgo: 2, purpose: 'prepayment' }],
    assignee: 'owner',
    withPhotos: true,
  },
  {
    clientIndex: 6,
    vehicleIndex: 6,
    title: 'Крыло и порог после парковки',
    status: 'scheduled',
    createdDaysAgo: 2,
    estimateRubles: 8000,
    assignee: 'employee',
  },
  {
    clientIndex: 7,
    vehicleIndex: 7,
    title: 'Капот: две вмятины M',
    status: 'pending_approval',
    createdDaysAgo: 1,
    estimateRubles: 5000,
    assignee: 'owner',
  },
  {
    clientIndex: 0,
    vehicleIndex: 8,
    title: 'Осмотр после града',
    status: 'new',
    createdDaysAgo: 0,
    assignee: 'owner',
  },
  {
    clientIndex: 2,
    vehicleIndex: 9,
    title: 'Замена элемента — не наш случай',
    status: 'cancelled',
    createdDaysAgo: 12,
    assignee: 'owner',
    cancelReason: 'Повреждено ЛКП, нужна окраска',
  },
];

async function seedWorkspace(input: {
  adminId: string;
  ownerId: string;
  employeeId: string;
}): Promise<string> {
  const workspace = await prisma.workspace.create({
    data: {
      name: 'Кузовной цех на Ленина',
      timezone: 'Europe/Moscow',
      currency: 'RUB',
      phone: '+7 916 000-00-00',
      address: 'Москва, ул. Ленина, 14, бокс 3',
      createdById: input.ownerId,
      settings: {
        employees_see_all_orders: true,
        employees_can_assign: false,
        employees_can_edit_estimates: true,
        employees_can_take_payments: true,
        work_day_start: '09:00',
        work_day_end: '20:00',
        default_appointment_minutes: 60,
        reminder_lead_minutes: 60,
      } as Prisma.InputJsonValue,
    },
  });

  await prisma.accessGrant.create({
    data: {
      product: 'crm',
      subjectType: 'workspace',
      workspaceId: workspace.id,
      status: 'active',
      validFrom: daysAgo(60),
      validUntil: daysAhead(180),
      grantedById: input.adminId,
      reason: 'Демонстрационный доступ',
    },
  });

  const owner = await prisma.workspaceMember.create({
    data: {
      workspaceId: workspace.id,
      userId: input.ownerId,
      role: 'owner',
      displayName: 'Дмитрий',
      color: '#2f80ed',
      joinedAt: daysAgo(60),
    },
  });
  const employee = await prisma.workspaceMember.create({
    data: {
      workspaceId: workspace.id,
      userId: input.employeeId,
      role: 'employee',
      displayName: 'Олег',
      color: '#27ae60',
      joinedAt: daysAgo(30),
    },
  });

  for (const [index, item] of PRICE_LIST.entries()) {
    await prisma.priceListItem.create({
      data: {
        workspaceId: workspace.id,
        kind: item.kind ?? 'damage',
        title: item.title,
        panelCode: item.panel,
        damageType: item.type ?? null,
        sizeClass: item.size,
        unitPriceMinor: minor(item.price),
        unit: 'per_item',
        position: index + 1,
      },
    });
  }

  // Справочник арматурных работ мастерской: те же позиции прайса, только
  // не для повреждений. Мастер правит цены и архивирует ненужные.
  for (const [index, work] of DEFAULT_EXTRA_WORKS.entries()) {
    await prisma.priceListItem.create({
      data: {
        workspaceId: workspace.id,
        kind: 'disassembly',
        title: work.title,
        unitPriceMinor: BigInt(work.priceMinor),
        unit: 'per_item',
        position: 100 + index,
      },
    });
  }

  const clientIds: string[] = [];
  for (const client of CLIENTS) {
    const created = await prisma.client.create({
      data: {
        workspaceId: workspace.id,
        name: client.name,
        phone: client.phone,
        source: client.source,
        createdById: input.ownerId,
        createdAt: daysAgo(50 - clientIds.length * 4),
        tags: client.source === 'Повторный' ? ['постоянный'] : [],
      },
    });
    clientIds.push(created.id);
  }

  const vehicleIds: string[] = [];
  for (const [index, vehicle] of VEHICLES.entries()) {
    const created = await prisma.vehicle.create({
      data: {
        workspaceId: workspace.id,
        clientId: clientIds[index % clientIds.length]!,
        make: vehicle.make,
        model: vehicle.model,
        year: vehicle.year,
        color: vehicle.color,
        plate: vehicle.plate,
      },
    });
    vehicleIds.push(created.id);
  }

  let orderNumber = 0;

  for (const spec of ORDERS) {
    orderNumber += 1;
    const assigneeId = spec.assignee === 'employee' ? employee.id : owner.id;
    const createdAt = daysAgo(spec.createdDaysAgo);

    const order = await prisma.order.create({
      data: {
        workspaceId: workspace.id,
        number: orderNumber,
        clientId: clientIds[spec.clientIndex]!,
        vehicleId: vehicleIds[spec.vehicleIndex]!,
        assigneeMemberId: assigneeId,
        status: spec.status,
        currency: 'RUB',
        title: spec.title,
        damageSummary:
          spec.status === 'new' ? null : 'Осмотр проведён, ЛКП целое, ремонт по технологии PDR.',
        createdById: input.ownerId,
        createdAt,
        startedAt: ['in_progress', 'ready', 'delivered'].includes(spec.status)
          ? daysAgo(spec.createdDaysAgo - 1)
          : null,
        readyAt: ['ready', 'delivered'].includes(spec.status)
          ? daysAgo(spec.createdDaysAgo - 2)
          : null,
        deliveredAt: spec.status === 'delivered' ? daysAgo(spec.createdDaysAgo - 3) : null,
        cancelledAt: spec.status === 'cancelled' ? daysAgo(spec.createdDaysAgo - 1) : null,
        cancelReason: spec.cancelReason ?? null,
      },
    });

    await prisma.orderStatusHistory.create({
      data: {
        workspaceId: workspace.id,
        orderId: order.id,
        fromStatus: null,
        toStatus: 'new',
        changedById: input.ownerId,
        comment: 'Заказ создан',
        createdAt,
      },
    });
    if (spec.status !== 'new') {
      await prisma.orderStatusHistory.create({
        data: {
          workspaceId: workspace.id,
          orderId: order.id,
          fromStatus: 'new',
          toStatus: spec.status,
          changedById: input.ownerId,
          comment: spec.cancelReason ?? null,
          createdAt: daysAgo(Math.max(spec.createdDaysAgo - 1, 0)),
        },
      });
    }

    if (spec.estimateRubles) {
      const agreed = !['new', 'pending_approval'].includes(spec.status);
      const subtotal = minor(spec.estimateRubles);

      const estimate = await prisma.estimate.create({
        data: {
          workspaceId: workspace.id,
          orderId: order.id,
          versionNo: 1,
          status: agreed ? 'agreed' : 'sent',
          currency: 'RUB',
          subtotalMinor: subtotal,
          discountKind: 'none',
          discountValue: 0,
          discountMinor: BigInt(0),
          totalMinor: subtotal,
          noteForClient: 'Срок работ — один день. Гарантия на ремонт — 12 месяцев.',
          createdById: input.ownerId,
          createdAt,
          sentAt: createdAt,
          agreedAt: agreed ? daysAgo(Math.max(spec.createdDaysAgo - 1, 0)) : null,
          agreedById: agreed ? input.ownerId : null,
        },
      });

      await prisma.estimateItem.create({
        data: {
          workspaceId: workspace.id,
          estimateId: estimate.id,
          position: 1,
          kind: 'damage',
          title: spec.title,
          panelCode: spec.title.toLowerCase().includes('капот') ? 'hood' : 'door_fl',
          damageType: spec.title.toLowerCase().includes('град') ? 'hail' : 'dent',
          sizeClass: 'M',
          quantity: 1,
          unitPriceMinor: subtotal,
          lineTotalMinor: subtotal,
        },
      });

      if (agreed) {
        await prisma.order.update({
          where: { id: order.id },
          data: { agreedEstimateId: estimate.id, agreedTotalMinor: subtotal },
        });
      }
    }

    let paidTotal = BigInt(0);
    for (const payment of spec.paid ?? []) {
      paidTotal += minor(payment.rubles);
      await prisma.paymentEntry.create({
        data: {
          workspaceId: workspace.id,
          orderId: order.id,
          kind: 'payment',
          amountMinor: minor(payment.rubles),
          currency: 'RUB',
          method: payment.rubles > 10000 ? 'transfer' : 'cash',
          purpose: payment.purpose,
          occurredAt: daysAgo(payment.daysAgo),
          createdById: input.ownerId,
          createdAt: daysAgo(payment.daysAgo),
        },
      });
    }

    if (paidTotal > BigInt(0)) {
      const agreedTotal = spec.estimateRubles ? minor(spec.estimateRubles) : null;
      await prisma.order.update({
        where: { id: order.id },
        data: {
          paidMinor: paidTotal,
          paymentStatus:
            agreedTotal === null || paidTotal < agreedTotal
              ? 'partial'
              : paidTotal === agreedTotal
                ? 'paid'
                : 'overpaid',
        },
      });
    }

    if (spec.withPhotos) {
      const categories: {
        category: 'before' | 'during' | 'after';
        label: string;
        color: string;
      }[] = [
        { category: 'before', label: 'До ремонта', color: '#8e5b5b' },
        { category: 'during', label: 'В процессе', color: '#5b6f8e' },
        { category: 'after', label: 'После ремонта', color: '#4f8e5b' },
      ];
      for (const [index, photo] of categories.entries()) {
        const fileId = await createPhotoFile({
          ownerUserId: input.ownerId,
          workspaceId: workspace.id,
          label: photo.label,
          color: photo.color,
        });
        await prisma.orderPhoto.create({
          data: {
            workspaceId: workspace.id,
            orderId: order.id,
            fileId,
            category: photo.category,
            caption: `${photo.label}: ${spec.title.toLowerCase()}`,
            position: index + 1,
            createdById: input.ownerId,
          },
        });
      }
    }
  }

  // Счётчик номеров догоняет вставленные данные, иначе первый же заказ,
  // созданный из интерфейса, упрётся в уникальный индекс (workspace_id, number).
  await prisma.workspace.update({
    where: { id: workspace.id },
    data: { orderSeq: orderNumber },
  });

  // Корректировка и возврат: в журнале оплат видно, как исправляют ошибки.
  const firstOrder = await prisma.order.findFirstOrThrow({
    where: { workspaceId: workspace.id, number: 1 },
  });
  await prisma.paymentEntry.create({
    data: {
      workspaceId: workspace.id,
      orderId: firstOrder.id,
      kind: 'correction',
      amountMinor: minor(500),
      currency: 'RUB',
      method: 'cash',
      purpose: 'correction',
      occurredAt: daysAgo(41),
      note: 'Ошибка в сумме при приёме наличных',
      createdById: input.ownerId,
      createdAt: daysAgo(41),
    },
  });
  await prisma.order.update({
    where: { id: firstOrder.id },
    data: { paidMinor: minor(26500), paymentStatus: 'partial' },
  });

  // Календарь: прошедшие, сегодняшние и будущие записи.
  const activeOrders = await prisma.order.findMany({
    where: { workspaceId: workspace.id, status: { in: ['scheduled', 'in_progress', 'ready'] } },
    orderBy: { number: 'asc' },
  });

  /**
   * Время записей задаётся в часовом поясе мастерской, а не сервера:
   * иначе «сегодня» в демо-данных не совпадает с «сегодня» на экране мастера.
   */
  const zone = 'Europe/Moscow';
  const dayIso = (offsetDays: number): string => {
    const base = new Date(`${todayInZone(zone)}T12:00:00Z`);
    base.setUTCDate(base.getUTCDate() + offsetDays);
    return base.toISOString().slice(0, 10);
  };
  const workshopTime = (offsetDays: number, hour: number, minutes = 0): Date =>
    zonedTimeToUtc(
      `${dayIso(offsetDays)}T${String(hour).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`,
      zone,
    );
  const todayAt = (hour: number, minutes = 0): Date => workshopTime(0, hour, minutes);

  const appointments: Prisma.AppointmentUncheckedCreateInput[] = [
    {
      workspaceId: workspace.id,
      orderId: activeOrders[0]?.id ?? null,
      clientId: clientIds[6]!,
      assigneeMemberId: owner.id,
      startsAt: todayAt(10),
      endsAt: todayAt(11, 30),
      kind: 'repair',
      status: 'confirmed',
      note: 'Клиент подтвердил по телефону',
      createdById: input.ownerId,
    },
    {
      workspaceId: workspace.id,
      orderId: activeOrders[1]?.id ?? null,
      clientId: clientIds[5]!,
      assigneeMemberId: employee.id,
      startsAt: todayAt(12),
      endsAt: todayAt(13),
      kind: 'inspection',
      status: 'planned',
      createdById: input.ownerId,
    },
    {
      workspaceId: workspace.id,
      clientId: clientIds[4]!,
      assigneeMemberId: owner.id,
      startsAt: todayAt(15),
      endsAt: todayAt(16),
      kind: 'delivery',
      status: 'planned',
      title: 'Выдача после града',
      createdById: input.ownerId,
    },
    {
      workspaceId: workspace.id,
      clientId: clientIds[3]!,
      assigneeMemberId: owner.id,
      startsAt: workshopTime(1, 11),
      endsAt: workshopTime(1, 12, 30),
      kind: 'repair',
      status: 'planned',
      createdById: input.ownerId,
    },
    {
      workspaceId: workspace.id,
      clientId: clientIds[2]!,
      assigneeMemberId: employee.id,
      startsAt: workshopTime(2, 9, 30),
      endsAt: workshopTime(2, 11),
      kind: 'repair',
      status: 'planned',
      createdById: input.ownerId,
    },
    {
      workspaceId: workspace.id,
      clientId: clientIds[1]!,
      assigneeMemberId: owner.id,
      startsAt: workshopTime(-3, 10),
      endsAt: workshopTime(-3, 11),
      kind: 'repair',
      status: 'done',
      createdById: input.ownerId,
    },
    {
      workspaceId: workspace.id,
      clientId: clientIds[0]!,
      assigneeMemberId: employee.id,
      startsAt: workshopTime(-5, 14),
      endsAt: workshopTime(-5, 15),
      kind: 'inspection',
      status: 'no_show',
      cancelReason: 'Клиент не приехал и не предупредил',
      createdById: input.ownerId,
    },
  ];

  for (const appointment of appointments) {
    await prisma.appointment.create({ data: appointment });
  }

  await prisma.order.updateMany({
    where: { workspaceId: workspace.id, status: 'scheduled' },
    data: { scheduledStartAt: todayAt(10) },
  });

  await seedLeads({
    workspaceId: workspace.id,
    ownerUserId: input.ownerId,
    ownerMemberId: owner.id,
  });

  return workspace.id;
}

/**
 * Обращения: главный экран мастерской показывает счётчики по ним, поэтому в
 * демо нужны все характерные состояния — от свежего сообщения в Telegram до
 * отказа и уже превращённого в заказ обращения.
 */
interface LeadSpec {
  contactName: string;
  contactPhone: string | null;
  contactExtra: string | null;
  vehicleMake: string;
  vehicleModel: string;
  vehiclePlate: string | null;
  source: 'online' | 'offline';
  channel: 'telegram' | 'whatsapp' | 'vk' | 'call' | 'in_person' | 'other';
  status: 'new' | 'estimated' | 'awaiting_decision' | 'callback' | 'scheduled' | 'rejected';
  comment: string;
  estimate: number | null;
  createdDaysAgo: number;
  /** Через сколько дней связаться. Отрицательное — срок уже прошёл. */
  contactInDays?: number;
  rejectReason?: string;
  withPhoto?: boolean;
  damages?: {
    panel: string;
    type: string;
    size: string;
    widthMm: number;
    heightMm?: number;
    price: number;
  }[];
  /** Коэффициент цены этой оценки в процентах. */
  coefficient?: number;
  /** Арматурные работы к оценке: название из справочника и цена. */
  extras?: { title: string; price: number }[];
}

const LEADS: LeadSpec[] = [
  {
    contactName: 'Марина',
    contactPhone: '+79031234567',
    contactExtra: '@marina_pdr',
    vehicleMake: 'Kia',
    vehicleModel: 'Rio',
    vehiclePlate: 'Т444ТТ96',
    source: 'online',
    channel: 'telegram',
    status: 'new',
    comment: 'Прислала фото: вмятина на двери после парковки. Спрашивает цену.',
    estimate: null,
    createdDaysAgo: 0,
    withPhoto: true,
    damages: [{ panel: 'door_fl', type: 'door_ding', size: 'M', widthMm: 40, price: 4500 }],
  },
  {
    contactName: 'Артём',
    contactPhone: '+79041112233',
    contactExtra: null,
    vehicleMake: 'Hyundai',
    vehicleModel: 'Solaris',
    vehiclePlate: 'У777УУ96',
    source: 'online',
    channel: 'whatsapp',
    status: 'estimated',
    comment: 'Град, капот и крыша. Прислал восемь фотографий.',
    estimate: 32_000,
    createdDaysAgo: 2,
    withPhoto: true,
    damages: [
      { panel: 'hood', type: 'hail', size: 'S', widthMm: 15, price: 18_000 },
      { panel: 'roof', type: 'hail', size: 'S', widthMm: 15, price: 14_000 },
    ],
  },
  {
    contactName: 'Николай',
    contactPhone: '+79087776655',
    contactExtra: null,
    vehicleMake: 'Skoda',
    vehicleModel: 'Octavia',
    vehiclePlate: 'Х123ХХ96',
    source: 'offline',
    channel: 'in_person',
    status: 'estimated',
    comment: 'Приехал сам: вмятина на передней левой двери, зона 40×40. Нужна разборка двери.',
    // База 9 000 (зона 40×40) × 1.20 = 10 800, плюс разбор двери 2 000.
    estimate: 12_800,
    createdDaysAgo: 1,
    coefficient: 120,
    damages: [
      { panel: 'door_fl', type: 'dent', size: '40x40', widthMm: 400, heightMm: 400, price: 10_800 },
    ],
    extras: [{ title: 'Разбор двери', price: 2000 }],
  },
  {
    contactName: 'Сергей',
    contactPhone: '+79095554433',
    contactExtra: null,
    vehicleMake: 'Toyota',
    vehicleModel: 'Camry',
    vehiclePlate: null,
    source: 'online',
    channel: 'call',
    status: 'awaiting_decision',
    comment: 'Назвали цену по телефону, думает.',
    estimate: 12_000,
    createdDaysAgo: 4,
    contactInDays: 2,
  },
  {
    contactName: 'Ольга',
    contactPhone: '+79026667788',
    contactExtra: null,
    vehicleMake: 'Renault',
    vehicleModel: 'Duster',
    vehiclePlate: 'Х100ХХ96',
    source: 'offline',
    channel: 'in_person',
    status: 'callback',
    comment: 'Приезжала на осмотр, просила перезвонить после зарплаты.',
    estimate: 9_500,
    createdDaysAgo: 9,
    contactInDays: -2,
  },
  {
    contactName: 'Дмитрий',
    contactPhone: '+79087776655',
    contactExtra: null,
    vehicleMake: 'Skoda',
    vehicleModel: 'Octavia',
    vehiclePlate: 'Е321ЕЕ96',
    source: 'online',
    channel: 'vk',
    status: 'scheduled',
    comment: 'Записан на осмотр, вмятина на крыле.',
    estimate: 6_000,
    createdDaysAgo: 6,
  },
  {
    contactName: 'Без имени',
    contactPhone: null,
    contactExtra: '@cold_lead',
    vehicleMake: 'Lada',
    vehicleModel: 'Vesta',
    vehiclePlate: null,
    source: 'online',
    channel: 'telegram',
    status: 'rejected',
    comment: 'Спросил цену и пропал.',
    estimate: 7_000,
    createdDaysAgo: 15,
    rejectReason: 'Дорого, поехал в другой сервис',
  },
];

async function seedLeads(input: {
  workspaceId: string;
  ownerUserId: string;
  ownerMemberId: string;
}): Promise<void> {
  let number = 0;

  for (const spec of LEADS) {
    number += 1;
    const createdAt = daysAgo(spec.createdDaysAgo);

    const lead = await prisma.lead.create({
      data: {
        workspaceId: input.workspaceId,
        number,
        contactName: spec.contactName,
        contactPhone: spec.contactPhone,
        contactExtra: spec.contactExtra,
        vehicleMake: spec.vehicleMake,
        vehicleModel: spec.vehicleModel,
        vehiclePlate: spec.vehiclePlate,
        source: spec.source,
        channel: spec.channel,
        status: spec.status,
        comment: spec.comment,
        estimateMinor: spec.estimate === null ? null : minor(spec.estimate),
        currency: 'RUB',
        nextContactAt: spec.contactInDays === undefined ? null : daysAgo(-spec.contactInDays),
        rejectReason: spec.rejectReason ?? null,
        assigneeMemberId: input.ownerMemberId,
        createdById: input.ownerUserId,
        createdAt,
      },
    });

    await prisma.leadStatusHistory.create({
      data: {
        workspaceId: input.workspaceId,
        leadId: lead.id,
        fromStatus: null,
        toStatus: 'new',
        changedById: input.ownerUserId,
        comment: 'Обращение создано',
        createdAt,
      },
    });
    if (spec.status !== 'new') {
      await prisma.leadStatusHistory.create({
        data: {
          workspaceId: input.workspaceId,
          leadId: lead.id,
          fromStatus: 'new',
          toStatus: spec.status,
          changedById: input.ownerUserId,
          comment: spec.rejectReason ?? null,
          createdAt: daysAgo(Math.max(0, spec.createdDaysAgo - 1)),
        },
      });
    }

    const damageIds: string[] = [];
    for (const [index, damage] of (spec.damages ?? []).entries()) {
      const created = await prisma.damage.create({
        data: {
          workspaceId: input.workspaceId,
          leadId: lead.id,
          panelCode: damage.panel,
          damageType: damage.type,
          sizeClass: damage.size,
          widthMm: damage.widthMm,
          heightMm: damage.heightMm ?? damage.widthMm,
          quantity: 1,
          priceMinor: minor(damage.price),
          priceSource: 'params',
          position: index + 1,
          createdById: input.ownerUserId,
          createdAt,
        },
      });
      damageIds.push(created.id);
    }

    if (spec.withPhoto) {
      const fileId = await createPhotoFile({
        ownerUserId: input.ownerUserId,
        workspaceId: input.workspaceId,
        label: `Обращение №${number}`,
        color: '#7a5b8e',
      });
      await prisma.orderPhoto.create({
        data: {
          workspaceId: input.workspaceId,
          leadId: lead.id,
          fileId,
          category: 'before',
          damageId: damageIds[0] ?? null,
          caption: `${spec.vehicleMake} ${spec.vehicleModel}`,
          position: 1,
          createdById: input.ownerUserId,
          createdAt,
        },
      });
    }

    // Сохранённая оценка: в карточке обращения видно, откуда взялась сумма.
    if (spec.estimate !== null) {
      const coefficient = spec.coefficient ?? 100;
      // Цены повреждений в спецификации уже с коэффициентом: база считается
      // обратно, чтобы формула «база × коэффициент» сходилась с итогом.
      const pdrMinor = (spec.damages ?? []).reduce((sum, d) => sum + minor(d.price), 0n);
      const baseMinor = minor(Number(pdrMinor) / 100 / (coefficient / 100));
      const extrasMinor = (spec.extras ?? []).reduce((sum, e) => sum + minor(e.price), 0n);

      const assessment = await prisma.assessment.create({
        data: {
          workspaceId: input.workspaceId,
          leadId: lead.id,
          method: damageIds.length > 0 ? 'params' : 'manual',
          currency: 'RUB',
          suggestedMinor: minor(spec.estimate),
          baseMinor,
          priceCoefficient: coefficient,
          extrasMinor,
          totalMinor: minor(spec.estimate),
          overridden: damageIds.length === 0,
          explanation:
            damageIds.length > 0
              ? 'Расчёт по прайсу мастерской'
              : 'Стоимость названа мастером по телефону',
          createdById: input.ownerUserId,
          createdAt,
        },
      });

      for (const [index, damage] of (spec.damages ?? []).entries()) {
        await prisma.assessmentItem.create({
          data: {
            workspaceId: input.workspaceId,
            assessmentId: assessment.id,
            damageId: damageIds[index] ?? null,
            kind: 'damage',
            position: index + 1,
            panelCode: damage.panel,
            damageType: damage.type,
            sizeClass: damage.size,
            widthMm: damage.widthMm,
            heightMm: damage.heightMm ?? damage.widthMm,
            quantity: 1,
            suggestedUnitPriceMinor: minor(damage.price),
            unitPriceMinor: minor(damage.price),
            lineTotalMinor: minor(damage.price),
          },
        });
      }

      for (const [index, extra] of (spec.extras ?? []).entries()) {
        const fromCatalog = await prisma.priceListItem.findFirst({
          where: { workspaceId: input.workspaceId, kind: 'disassembly', title: extra.title },
        });
        await prisma.assessmentItem.create({
          data: {
            workspaceId: input.workspaceId,
            assessmentId: assessment.id,
            damageId: damageIds[0] ?? null,
            kind: 'disassembly',
            title: extra.title,
            position: (spec.damages?.length ?? 0) + index + 1,
            quantity: 1,
            suggestedUnitPriceMinor: fromCatalog?.unitPriceMinor ?? minor(extra.price),
            unitPriceMinor: minor(extra.price),
            lineTotalMinor: minor(extra.price),
            priceListItemId: fromCatalog?.id ?? null,
          },
        });
      }
    }
  }

  // Счётчик номеров догоняет вставленные обращения: иначе первое созданное
  // из интерфейса упрётся в уникальный индекс (workspace_id, number).
  await prisma.workspace.update({
    where: { id: input.workspaceId },
    data: { leadSeq: number },
  });
}

/** Вторая мастерская: доступ к CRM закончился — видно состояние «только чтение». */
async function seedExpiredWorkspace(adminId: string, ownerId: string): Promise<void> {
  const workspace = await prisma.workspace.create({
    data: {
      name: 'Гараж на Мира (доступ истёк)',
      timezone: 'Asia/Yekaterinburg',
      currency: 'RUB',
      createdById: ownerId,
      settings: {} as Prisma.InputJsonValue,
    },
  });

  await prisma.accessGrant.create({
    data: {
      product: 'crm',
      subjectType: 'workspace',
      workspaceId: workspace.id,
      status: 'expired',
      validFrom: daysAgo(120),
      validUntil: daysAgo(10),
      grantedById: adminId,
      reason: 'Демонстрация состояния «доступ истёк»',
    },
  });

  const member = await prisma.workspaceMember.create({
    data: { workspaceId: workspace.id, userId: ownerId, role: 'owner', joinedAt: daysAgo(120) },
  });

  const client = await prisma.client.create({
    data: {
      workspaceId: workspace.id,
      name: 'Андрей Мельников',
      phone: '+79090000001',
      createdById: ownerId,
    },
  });
  const vehicle = await prisma.vehicle.create({
    data: {
      workspaceId: workspace.id,
      clientId: client.id,
      make: 'Ford',
      model: 'Focus',
      year: 2015,
      plate: 'Н555ЕР196',
    },
  });
  await prisma.order.create({
    data: {
      workspaceId: workspace.id,
      number: 1,
      clientId: client.id,
      vehicleId: vehicle.id,
      assigneeMemberId: member.id,
      status: 'delivered',
      currency: 'RUB',
      title: 'Вмятина на двери',
      agreedTotalMinor: minor(6000),
      paidMinor: minor(6000),
      paymentStatus: 'paid',
      createdById: ownerId,
      createdAt: daysAgo(40),
      deliveredAt: daysAgo(38),
    },
  });
  await prisma.workspace.update({ where: { id: workspace.id }, data: { orderSeq: 1 } });
}

/** Русское склонение числительных для текстов демо-данных. */
function pluralRu(n: number, forms: [string, string, string]): string {
  const abs = Math.abs(n) % 100;
  const tail = abs % 10;
  if (abs > 10 && abs < 20) return forms[2];
  if (tail > 1 && tail < 5) return forms[1];
  if (tail === 1) return forms[0];
  return forms[2];
}

// ── Запуск ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (process.env.APP_ENV === 'production') {
    throw new Error('Демо-данные нельзя заливать в production');
  }

  // Автоматический деплой запускает сидер при каждом старте контейнера.
  // Пересев там означал бы потерю всего, что ввели руками на staging,
  // поэтому в этом режиме сидер работает только по пустой базе.
  if (process.env.SEED_ONLY_IF_EMPTY === 'true' && (await prisma.user.count()) > 0) {
    console.log('База не пуста — демо-данные не трогаю.');
    return;
  }

  console.log('Очистка базы…');
  await wipe();

  console.log('Пользователи…');
  const adminId = await createUser({
    key: 'admin',
    firstName: 'Анна',
    lastName: 'Администратор',
    username: 'demo_admin',
    platformRole: 'admin',
  });
  const curatorId = await createUser({
    key: 'curator',
    firstName: 'Сергей',
    lastName: 'Куратор',
    username: 'demo_curator',
    platformRole: 'curator',
  });
  const studentId = await createUser({
    key: 'student',
    firstName: 'Игорь',
    lastName: 'Ученик',
    username: 'demo_student',
  });
  const newStudentId = await createUser({
    key: 'student_new',
    firstName: 'Павел',
    lastName: 'Новичок',
    username: 'demo_student_new',
  });
  const masterId = await createUser({
    key: 'master',
    firstName: 'Дмитрий',
    lastName: 'Мастер',
    username: 'demo_master',
  });
  const employeeId = await createUser({
    key: 'employee',
    firstName: 'Олег',
    lastName: 'Сотрудник',
    username: 'demo_employee',
  });
  const expiredOwnerId = await createUser({
    key: 'expired',
    firstName: 'Виктор',
    lastName: 'Бывший',
    username: 'demo_expired',
  });

  console.log('Курс и этапы…');
  const course = await seedCourse(adminId);

  console.log('Ученики и прогресс…');
  await seedLearning({
    adminId,
    curatorId,
    studentId,
    newStudentId,
    courseId: course.courseId,
    versionId: course.versionId,
  });

  console.log('Мастерская, заказы, календарь, фото…');
  await seedWorkspace({ adminId, ownerId: masterId, employeeId });
  await seedExpiredWorkspace(adminId, expiredOwnerId);

  console.log('Клуб…');
  for (const [userId, joined] of [
    [masterId, true],
    [studentId, false],
  ] as const) {
    await prisma.accessGrant.create({
      data: {
        product: 'club',
        subjectType: 'user',
        userId,
        status: 'active',
        validFrom: daysAgo(30),
        validUntil: daysAhead(90),
        grantedById: adminId,
        reason: 'Демонстрационный доступ',
      },
    });
    if (joined) {
      await prisma.clubMembership.create({
        data: {
          userId,
          chatId: process.env.TELEGRAM_CLUB_CHAT_ID || '-1000000000000',
          telegramStatus: 'member',
          joinedAt: daysAgo(28),
        },
      });
      await prisma.clubEvent.create({
        data: {
          userId,
          event: 'approved',
          payload: { source: 'demo' } as Prisma.InputJsonValue,
          createdAt: daysAgo(28),
        },
      });
    }
  }

  console.log('Отметка о резервной копии…');
  await prisma.backupRun.create({
    data: {
      label: 'scheduled',
      objectKey: `db/${new Date().toISOString().slice(0, 7).replace('-', '/')}/pdr-demo.dump`,
      sizeBytes: BigInt(18_400_000),
      createdAt: new Date(now - 6 * 3_600_000),
    },
  });

  const counts = {
    пользователи: await prisma.user.count(),
    мастерские: await prisma.workspace.count(),
    клиенты: await prisma.client.count(),
    автомобили: await prisma.vehicle.count(),
    заказы: await prisma.order.count(),
    записи: await prisma.appointment.count(),
    сметы: await prisma.estimate.count(),
    оплаты: await prisma.paymentEntry.count(),
    фотографии: await prisma.orderPhoto.count(),
    обращения: await prisma.lead.count(),
    повреждения: await prisma.damage.count(),
    оценки: await prisma.assessment.count(),
  };
  console.log('Демо-данные готовы:', counts);
  console.log(
    'Вход: ключи demo-аккаунтов — admin, curator, student, student_new, master, employee, expired',
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
