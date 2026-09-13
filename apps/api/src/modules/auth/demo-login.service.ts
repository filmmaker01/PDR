import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { AppConfigService } from '@/config/config.service';
import { AppError } from '@/common/errors/app.error';
import { SessionService, type IssuedSession } from './session.service';

export interface DemoAccount {
  key: string;
  name: string;
  /** Чем этот аккаунт полезен: что он видит и что может сделать. */
  description: string;
  platformRoles: string[];
  workspaces: { id: string; name: string; role: string }[];
  hasCourse: boolean;
  hasClub: boolean;
}

/**
 * Вход демонстрационными аккаунтами без Telegram.
 *
 * Нужен на staging: приложение открывают в обычном браузере, чтобы посмотреть
 * продукт до того, как появятся токен бота и домен Mini App. В production
 * включение запрещено проверкой конфигурации, а не только договорённостью.
 */
@Injectable()
export class DemoLoginService {
  private readonly logger = new Logger(DemoLoginService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly sessions: SessionService,
  ) {}

  get enabled(): boolean {
    return this.config.env.DEMO_LOGIN_ENABLED && this.config.env.APP_ENV !== 'production';
  }

  private assertEnabled(): void {
    // 404, а не 403: наличие демо-входа не раскрывается там, где он выключен.
    if (!this.enabled) throw AppError.notFound('Демо-вход недоступен');
  }

  private assertSecret(secret?: string | null): void {
    const expected = this.config.env.DEMO_LOGIN_SECRET;
    if (!expected) return;
    if (secret !== expected) throw AppError.notFound('Демо-вход недоступен');
  }

  /** Список демо-аккаунтов для экрана выбора. */
  async accounts(secret?: string | null): Promise<DemoAccount[]> {
    this.assertEnabled();
    this.assertSecret(secret);

    const users = await this.prisma.user.findMany({
      where: { demoKey: { not: null } },
      include: {
        platformRoles: true,
        workspaceMemberships: {
          where: { isActive: true },
          include: { workspace: { select: { id: true, name: true } } },
        },
        accessGrants: { where: { status: 'active' } },
        enrollments: { where: { status: 'active' } },
      },
      orderBy: { createdAt: 'asc' },
    });

    return users.map((user) => ({
      key: user.demoKey!,
      name: [user.firstName, user.lastName].filter(Boolean).join(' '),
      description: DEMO_DESCRIPTIONS[user.demoKey!] ?? 'Демонстрационный аккаунт',
      platformRoles: user.platformRoles.map((role) => role.role),
      workspaces: user.workspaceMemberships.map((membership) => ({
        id: membership.workspace.id,
        name: membership.workspace.name,
        role: membership.role,
      })),
      hasCourse: user.enrollments.length > 0,
      hasClub: user.accessGrants.some((grant) => grant.product === 'club'),
    }));
  }

  async login(
    key: string,
    meta: { userAgent?: string | null; ip?: string | null },
    secret?: string | null,
  ): Promise<IssuedSession & { userId: string }> {
    this.assertEnabled();
    this.assertSecret(secret);

    const user = await this.prisma.user.findFirst({ where: { demoKey: key } });
    if (!user) throw AppError.notFound('Демо-аккаунт не найден');
    if (user.isBanned) throw new AppError('user_banned', 'Демо-аккаунт заблокирован');

    this.logger.log({ demoKey: key }, 'Вход демо-аккаунтом');
    const issued = await this.sessions.issue(user.id, 'web', meta);
    return { ...issued, userId: user.id };
  }
}

const DEMO_DESCRIPTIONS: Record<string, string> = {
  student: 'Ученик: первый этап пройден, второй открыт, есть сданная и возвращённая работа',
  student_new: 'Новый ученик: курс только начат, видно пустые состояния',
  curator: 'Куратор: очередь проверок с работами и практическим экзаменом',
  master: 'Владелец мастерской: заказы, календарь, сметы, оплаты, аналитика',
  employee: 'Сотрудник мастерской: только свои заказы, без аналитики и прайса',
  admin: 'Администратор платформы: доступы, курс, группы, клуб, выгрузки',
  expired: 'Мастерская с истёкшим доступом: только чтение и выгрузка',
};
