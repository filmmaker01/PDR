/**
 * Заполнение базы данными для разработки и демонстрации.
 * Идемпотентно: повторный запуск не создаёт дублей.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  console.log('Seed: данных для этапа 0 нет, схема пуста.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
