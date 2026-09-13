/**
 * Заполнение базы данными для разработки и демонстрации.
 * Идемпотентно: повторный запуск не создаёт дублей.
 *
 * Первый администратор задаётся переменной SEED_ADMIN_TELEGRAM_ID.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function seedAdmin(): Promise<void> {
  const raw = process.env.SEED_ADMIN_TELEGRAM_ID;
  if (!raw) {
    console.log('SEED_ADMIN_TELEGRAM_ID не задан — администратор не создаётся.');
    return;
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
}

async function main(): Promise<void> {
  await seedAdmin();
  console.log('Seed завершён.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
