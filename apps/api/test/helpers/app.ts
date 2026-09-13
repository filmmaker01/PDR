import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '@/app.module';
import { AllExceptionsFilter } from '@/common/filters/all-exceptions.filter';
import { PrismaService } from '@/infra/prisma/prisma.service';

export interface TestApp {
  app: INestApplication;
  prisma: PrismaService;
  module: TestingModule;
  close(): Promise<void>;
}

let shared: TestApp | null = null;

/** Единое приложение на весь файл тестов: поднимать Nest на каждый тест дорого. */
export async function createTestApp(): Promise<TestApp> {
  if (shared) return shared;

  const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = module.createNestApplication({ logger: false });
  app.setGlobalPrefix('v1', { exclude: ['health', 'health/ready'] });
  app.useGlobalFilters(new AllExceptionsFilter(true));
  await app.init();

  const prisma = app.get(PrismaService);
  shared = {
    app,
    prisma,
    module,
    close: async () => {
      await app.close();
      shared = null;
    },
  };
  return shared;
}

/** Полная очистка данных между файлами тестов (кроме служебных таблиц Prisma). */
export async function truncateAll(prisma: PrismaService): Promise<void> {
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'
  `;
  if (rows.length === 0) return;
  const list = rows.map((r) => `"public"."${r.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}
