/**
 * Заполнение базы данными для разработки и демонстрации.
 * Идемпотентно: повторный запуск не создаёт дублей.
 *
 * Переменные:
 *   SEED_ADMIN_TELEGRAM_ID — первый администратор платформы
 *   SEED_DEMO=true         — демонстрационный курс из трёх этапов
 */
import { PrismaClient, type Prisma } from '@prisma/client';

const prisma = new PrismaClient();

async function seedAdmin(): Promise<string | null> {
  const raw = process.env.SEED_ADMIN_TELEGRAM_ID;
  if (!raw) {
    console.log('SEED_ADMIN_TELEGRAM_ID не задан — администратор не создаётся.');
    return null;
  }
  const telegramUserId = BigInt(raw);
  const user = await prisma.user.upsert({
    where: { telegramUserId },
    create: {
      telegramUserId,
      firstName: process.env.SEED_ADMIN_NAME ?? 'Администратор',
      username: process.env.SEED_ADMIN_USERNAME ?? null,
    },
    update: {},
  });
  await prisma.platformRole.upsert({
    where: { userId_role: { userId: user.id, role: 'admin' } },
    create: { userId: user.id, role: 'admin' },
    update: {},
  });
  console.log(`Администратор готов: telegram ${telegramUserId}, user ${user.id}`);
  return user.id;
}

interface DemoLesson {
  key: string;
  title: string;
  description: string;
  minutes: number;
}

interface DemoStage {
  key: string;
  title: string;
  description: string;
  unlockDaysOffset: number;
  lessons: DemoLesson[];
  assignment: {
    key: string;
    title: string;
    instructions: string;
    minPhotos: number;
    minVideos: number;
  };
  exam: {
    key: string;
    title: string;
    kind: 'test' | 'practical';
    passingScore: number;
    questions?: { body: string; options: [string, boolean][] }[];
  };
}

/**
 * Программа-заготовка: три последовательных этапа.
 * Содержание уточняется с преподавателем, структура остаётся той же.
 */
const DEMO_STAGES: DemoStage[] = [
  {
    key: 'stage-1',
    title: 'База PDR: свет, инструмент, металл',
    description:
      'Постановка света, чтение отражения, базовый набор крючков и насадок, поведение металла при надавливании.',
    unlockDaysOffset: 0,
    lessons: [
      {
        key: 'light',
        title: 'Свет и чтение отражения',
        description: 'Как поставить лампу и что показывает полоса.',
        minutes: 18,
      },
      {
        key: 'tools',
        title: 'Инструмент и захваты',
        description: 'Крючки, клеевая система, насадки: когда что берут.',
        minutes: 22,
      },
      {
        key: 'metal',
        title: 'Поведение металла',
        description: 'Натяжение, память металла, почему нельзя давить в центр.',
        minutes: 16,
      },
      {
        key: 'simple-dents',
        title: 'Простые вмятины',
        description: 'Круглые вмятины на плоскости: пошаговый разбор.',
        minutes: 25,
      },
    ],
    assignment: {
      key: 'practice-1',
      title: 'Первая вмятина на тренировочной детали',
      instructions:
        'Выправьте простую круглую вмятину на тренировочной детали.\n\nПришлите: фото «до» при поставленном свете, 2–3 фото процесса, фото «после» с тем же светом. Коротко опишите, какой инструмент использовали и что оказалось сложным.',
      minPhotos: 4,
      minVideos: 0,
    },
    exam: {
      key: 'test-1',
      title: 'Тест по базе',
      kind: 'test',
      passingScore: 70,
      questions: [
        {
          body: 'Что показывает полоса света на поверхности детали?',
          options: [
            ['Искажение отражения, по которому читают форму вмятины', true],
            ['Толщину лакокрасочного покрытия', false],
            ['Температуру металла', false],
          ],
        },
        {
          body: 'Почему нельзя сразу давить в центр вмятины?',
          options: [
            ['Металл натянут, центр отдавливается последним', true],
            ['Это портит инструмент', false],
            ['Так быстрее, но шумно', false],
          ],
        },
        {
          body: 'Что относится к беспокрасочному ремонту?',
          options: [
            ['Град без повреждения покрытия', true],
            ['Вмятина с сохранённым лакокрасочным покрытием', true],
            ['Сквозная коррозия', false],
          ],
        },
      ],
    },
  },
  {
    key: 'stage-2',
    title: 'Сложные повреждения и доступ',
    description: 'Град, заломы, работа через технологические отверстия, разборка элементов.',
    unlockDaysOffset: 30,
    lessons: [
      {
        key: 'hail',
        title: 'Град: методика обхода',
        description: 'Разметка, порядок обхода, контроль качества.',
        minutes: 28,
      },
      {
        key: 'creases',
        title: 'Заломы и ребра жёсткости',
        description: 'Почему ребро выправляют иначе и чем это опасно.',
        minutes: 24,
      },
      {
        key: 'access',
        title: 'Доступ и разборка',
        description: 'Когда снимать обшивку, а когда искать штатное отверстие.',
        minutes: 20,
      },
      {
        key: 'aluminum',
        title: 'Алюминий',
        description: 'Отличия от стали: память, нагрев, риск перетяжки.',
        minutes: 19,
      },
    ],
    assignment: {
      key: 'practice-2',
      title: 'Град на капоте',
      instructions:
        'Отработайте участок града на капоте.\n\nПришлите: фото разметки, фото «до», короткое видео работы (до 60 секунд), фото «после». Опишите порядок обхода и как контролировали результат.',
      minPhotos: 3,
      minVideos: 1,
    },
    exam: {
      key: 'test-2',
      title: 'Тест по сложным повреждениям',
      kind: 'test',
      passingScore: 75,
      questions: [
        {
          body: 'Чем ремонт ребра жёсткости отличается от ремонта плоскости?',
          options: [
            ['Ребро выправляют мелкими движениями вдоль, избегая перетяжки', true],
            ['Ребро выправляют одним сильным нажатием', false],
            ['Ребро не подлежит беспокрасочному ремонту', false],
          ],
        },
        {
          body: 'Что важно учесть при работе с алюминием?',
          options: [
            ['Металл хуже держит форму и легче перетягивается', true],
            ['Алюминий не деформируется', false],
            ['Алюминий всегда требует покраски', false],
          ],
        },
      ],
    },
  },
  {
    key: 'stage-3',
    title: 'Самостоятельная работа: оценка, ремонт, контроль',
    description: 'Осмотр автомобиля, составление расчёта, выполнение работы и приёмка результата.',
    unlockDaysOffset: 60,
    lessons: [
      {
        key: 'estimate',
        title: 'Осмотр и расчёт',
        description: 'Как считать позиции и объяснять цену клиенту.',
        minutes: 26,
      },
      {
        key: 'workflow',
        title: 'Ведение заказа',
        description: 'От записи до выдачи: что фиксировать на каждом шаге.',
        minutes: 21,
      },
      {
        key: 'quality',
        title: 'Контроль качества',
        description: 'Приёмка своими глазами и глазами клиента.',
        minutes: 17,
      },
    ],
    assignment: {
      key: 'case-3',
      title: 'Итоговый кейс: автомобиль целиком',
      instructions:
        'Проведите полный цикл на реальном автомобиле.\n\nПришлите: фото «до» по каждому повреждённому элементу, вашу смету (фото или текстом), фото «после», короткое видео обхода результата. Опишите, что бы сделали иначе.',
      minPhotos: 6,
      minVideos: 1,
    },
    exam: {
      key: 'final-exam',
      title: 'Итоговый практический экзамен',
      kind: 'practical',
      passingScore: 60,
    },
  },
];

async function seedDemoCourse(adminId: string | null): Promise<void> {
  if (process.env.SEED_DEMO !== 'true') {
    console.log('SEED_DEMO не включён — демонстрационный курс не создаётся.');
    return;
  }

  const existing = await prisma.course.findUnique({ where: { slug: 'pdr-base' } });
  if (existing) {
    console.log('Демонстрационный курс уже существует.');
    return;
  }

  const course = await prisma.course.create({
    data: {
      slug: 'pdr-base',
      title: 'PDR: от первой вмятины до самостоятельной работы',
      description:
        'Три последовательных этапа: база, сложные повреждения, самостоятельная работа с оценкой и контролем результата.',
    },
  });
  const version = await prisma.courseVersion.create({
    data: { courseId: course.id, versionNo: 1, status: 'draft' },
  });

  for (const [stageIndex, demo] of DEMO_STAGES.entries()) {
    const stage = await prisma.stage.create({
      data: {
        courseVersionId: version.id,
        key: demo.key,
        position: stageIndex + 1,
        title: demo.title,
        description: demo.description,
        unlockDaysOffset: demo.unlockDaysOffset,
        requiresPreviousStage: true,
      },
    });

    for (const [lessonIndex, lesson] of demo.lessons.entries()) {
      // Видео добавляет администратор: демонстрационные записи ссылок не имеют.
      const video = await prisma.videoAsset.create({
        data: {
          provider: 'mock',
          providerVideoId: `demo-${demo.key}-${lesson.key}`,
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
          position: lessonIndex + 1,
          title: lesson.title,
          description: lesson.description,
          isRequired: true,
          videoAssetId: video.id,
          minWatchPercent: 70,
          estimatedMinutes: lesson.minutes,
        },
      });
    }

    await prisma.assignment.create({
      data: {
        stageId: stage.id,
        key: demo.assignment.key,
        position: 1,
        title: demo.assignment.title,
        instructions: demo.assignment.instructions,
        isRequired: true,
        requiredMedia: {
          min_photos: demo.assignment.minPhotos,
          min_videos: demo.assignment.minVideos,
          text_required: true,
        } as Prisma.InputJsonValue,
        maxVideoSec: 90,
      },
    });

    const exam = await prisma.exam.create({
      data: {
        stageId: stage.id,
        key: demo.exam.key,
        position: 1,
        title: demo.exam.title,
        kind: demo.exam.kind,
        passingScore: demo.exam.passingScore,
        maxAttempts: demo.exam.kind === 'test' ? 3 : null,
        timeLimitSec: demo.exam.kind === 'test' ? 900 : null,
        cooldownHours: demo.exam.kind === 'test' ? 12 : 24,
        isRequired: true,
      },
    });

    for (const [questionIndex, question] of (demo.exam.questions ?? []).entries()) {
      const correctCount = question.options.filter(([, correct]) => correct).length;
      const created = await prisma.question.create({
        data: {
          examId: exam.id,
          position: questionIndex + 1,
          kind: correctCount > 1 ? 'multiple' : 'single',
          body: question.body,
          points: 1,
        },
      });
      for (const [optionIndex, [body, isCorrect]] of question.options.entries()) {
        await prisma.questionOption.create({
          data: { questionId: created.id, position: optionIndex + 1, body, isCorrect },
        });
      }
    }
  }

  console.log(`Демонстрационный курс создан: ${course.title} (черновик версии 1).`);
}

async function main(): Promise<void> {
  const adminId = await seedAdmin();
  await seedDemoCourse(adminId);
  console.log('Seed завершён.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
