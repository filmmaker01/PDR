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
