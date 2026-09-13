#!/usr/bin/env tsx
/**
 * Назначение роли платформы по Telegram ID.
 * Использование: tsx infra/scripts/grant-platform-role.ts <telegramId> <admin|curator> [имя]
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const [rawId, role, name] = process.argv.slice(2);
  if (!rawId || (role !== 'admin' && role !== 'curator')) {
    console.error('использование: grant-platform-role.ts <telegramId> <admin|curator> [имя]');
    process.exit(1);
  }

  const telegramUserId = BigInt(rawId);
  const user = await prisma.user.upsert({
    where: { telegramUserId },
    create: { telegramUserId, firstName: name ?? 'Сотрудник платформы' },
    update: {},
  });
  await prisma.platformRole.upsert({
    where: { userId_role: { userId: user.id, role } },
    create: { userId: user.id, role },
    update: {},
  });
  console.log(`Роль ${role} выдана пользователю ${user.id} (telegram ${telegramUserId}).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
