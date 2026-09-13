import { Injectable, Logger } from '@nestjs/common';
import type { User } from '@prisma/client';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { AppConfigService } from '@/config/config.service';
import { AppError } from '@/common/errors/app.error';
import { InitDataError, verifyInitData, verifyLoginWidget } from '@/infra/telegram/init-data';
import { UsersService } from '@/modules/users/users.service';
import { SessionService, type IssuedSession } from './session.service';
import { generateLoginCode } from './tokens';

const WEB_LOGIN_TTL_SEC = 300;

export interface LoginResult extends IssuedSession {
  user: User;
  /** Действие из deep-link: приглашение, переход к уроку и т. п. */
  startAction: string | null;
}

export interface RequestMeta {
  userAgent?: string | null;
  ip?: string | null;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly users: UsersService,
    private readonly sessions: SessionService,
  ) {}

  /** Вход из Mini App по initData. */
  async loginWithInitData(initData: string, meta: RequestMeta): Promise<LoginResult> {
    if (!this.config.env.TELEGRAM_BOT_TOKEN) {
      throw new AppError('service_unavailable', 'Вход через Telegram не настроен');
    }

    let parsed;
    try {
      parsed = verifyInitData(
        initData,
        this.config.env.TELEGRAM_BOT_TOKEN,
        this.config.env.TELEGRAM_INITDATA_MAX_AGE_SEC,
      );
    } catch (e) {
      if (e instanceof InitDataError) {
        this.logger.warn({ reason: e.reason }, 'Отклонён вход из Mini App');
        throw new AppError(
          'invalid_init_data',
          e.reason === 'expired'
            ? 'Данные входа устарели. Перезапустите приложение в Telegram'
            : 'Откройте приложение из Telegram',
        );
      }
      throw e;
    }

    const user = await this.users.upsertFromTelegram(parsed.user);
    this.assertNotBanned(user);

    const issued = await this.sessions.issue(user.id, 'miniapp', meta);
    return { ...issued, user, startAction: parsed.startParam };
  }

  /** Вход в веб-админку через Telegram Login Widget. */
  async loginWithWidget(data: Record<string, unknown>, meta: RequestMeta): Promise<LoginResult> {
    if (!this.config.env.TELEGRAM_BOT_TOKEN) {
      throw new AppError('service_unavailable', 'Вход через Telegram не настроен');
    }

    let payload;
    try {
      payload = verifyLoginWidget(
        data,
        this.config.env.TELEGRAM_BOT_TOKEN,
        this.config.env.TELEGRAM_LOGIN_MAX_AGE_SEC,
      );
    } catch (e) {
      if (e instanceof InitDataError) {
        throw new AppError('invalid_login_data', 'Не удалось подтвердить вход через Telegram');
      }
      throw e;
    }

    const user = await this.users.upsertFromTelegram(payload);
    this.assertNotBanned(user);
    await this.assertPlatformAccess(user.id);

    const issued = await this.sessions.issue(user.id, 'web', meta);
    return { ...issued, user, startAction: null };
  }

  /** Создание запроса на вход в админку с подтверждением в боте. */
  async createWebLoginRequest(meta: RequestMeta): Promise<{
    code: string;
    expiresAt: Date;
  }> {
    const code = generateLoginCode();
    const expiresAt = new Date(Date.now() + WEB_LOGIN_TTL_SEC * 1000);
    await this.prisma.webLoginRequest.create({
      data: {
        code,
        expiresAt,
        userAgent: meta.userAgent?.slice(0, 500) ?? null,
        ip: meta.ip ?? null,
      },
    });
    return { code, expiresAt };
  }

  /** Подтверждение из бота: привязывает пользователя к запросу. */
  async confirmWebLoginRequest(code: string, userId: string): Promise<void> {
    const request = await this.prisma.webLoginRequest.findUnique({ where: { code } });
    if (!request || request.status !== 'pending' || request.expiresAt.getTime() <= Date.now()) {
      throw new AppError('login_request_not_found', 'Запрос на вход не найден или устарел');
    }
    await this.assertPlatformAccess(userId);
    await this.prisma.webLoginRequest.update({
      where: { code },
      data: { status: 'confirmed', userId, confirmedAt: new Date() },
    });
  }

  /**
   * Опрос статуса запроса из админки.
   * Сессия выдаётся ровно один раз: повторный опрос вернёт `used`.
   */
  async pollWebLoginRequest(
    code: string,
    meta: RequestMeta,
  ): Promise<{ status: 'pending' | 'expired' | 'used' } | ({ status: 'confirmed' } & LoginResult)> {
    const request = await this.prisma.webLoginRequest.findUnique({ where: { code } });
    if (!request) throw new AppError('login_request_not_found', 'Запрос на вход не найден');

    if (request.status === 'pending' && request.expiresAt.getTime() <= Date.now()) {
      await this.prisma.webLoginRequest.update({ where: { code }, data: { status: 'expired' } });
      return { status: 'expired' };
    }
    if (request.status !== 'confirmed' || !request.userId) {
      return {
        status: request.status === 'pending' ? 'pending' : (request.status as 'expired' | 'used'),
      };
    }

    const claimed = await this.prisma.webLoginRequest.updateMany({
      where: { code, status: 'confirmed' },
      data: { status: 'used' },
    });
    if (claimed.count === 0) return { status: 'used' };

    const user = await this.users.getById(request.userId);
    this.assertNotBanned(user);
    const issued = await this.sessions.issue(user.id, 'web', meta);
    return { status: 'confirmed', ...issued, user, startAction: null };
  }

  async refresh(refreshToken: string, meta: RequestMeta): Promise<IssuedSession> {
    return this.sessions.refresh(refreshToken, meta);
  }

  private assertNotBanned(user: User): void {
    if (user.isBanned) {
      throw new AppError('user_banned', 'Доступ к платформе заблокирован');
    }
  }

  /** В админку входят только администраторы и кураторы. */
  private async assertPlatformAccess(userId: string): Promise<void> {
    const roles = await this.users.platformRoles(userId);
    if (roles.length === 0) {
      throw new AppError('platform_role_required', 'У вас нет доступа к панели администратора');
    }
  }

  /** Удаление устаревших запросов на вход (фоновая задача). */
  async cleanupLoginRequests(): Promise<number> {
    const result = await this.prisma.webLoginRequest.deleteMany({
      where: { createdAt: { lt: new Date(Date.now() - 86_400_000) } },
    });
    return result.count;
  }
}
