import { Injectable, Logger } from '@nestjs/common';
import type { Session, SessionKind, User } from '@prisma/client';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { AppConfigService } from '@/config/config.service';
import { AppError } from '@/common/errors/app.error';
import {
  generateRefreshToken,
  hashRefreshToken,
  signAccessToken,
  verifyAccessToken,
  TokenError,
  type AccessTokenPayload,
} from './tokens';

export interface IssuedSession {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  sessionId: string;
}

export interface SessionContext {
  user: User;
  session: Session;
}

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  async issue(
    userId: string,
    kind: SessionKind,
    meta: { userAgent?: string | null; ip?: string | null } = {},
  ): Promise<IssuedSession> {
    const { token, hash } = generateRefreshToken();
    const expiresAt = new Date(Date.now() + this.config.env.REFRESH_TOKEN_TTL_SEC * 1000);

    const session = await this.prisma.session.create({
      data: {
        userId,
        kind,
        refreshTokenHash: hash,
        expiresAt,
        userAgent: meta.userAgent?.slice(0, 500) ?? null,
        ip: meta.ip ?? null,
      },
    });

    return {
      ...this.buildAccess(userId, session.id, kind),
      refreshToken: token,
      sessionId: session.id,
    };
  }

  private buildAccess(
    userId: string,
    sessionId: string,
    kind: SessionKind,
  ): { accessToken: string; expiresIn: number } {
    const ttl = this.config.env.ACCESS_TOKEN_TTL_SEC;
    return {
      accessToken: signAccessToken(
        { sub: userId, sid: sessionId, kind },
        this.config.env.SESSION_JWT_SECRET,
        ttl,
      ),
      expiresIn: ttl,
    };
  }

  /**
   * Проверяет access-токен и состояние сессии.
   * Отзыв сессии и бан действуют немедленно: состояние читается из базы.
   */
  async authenticate(accessToken: string): Promise<SessionContext> {
    let payload: AccessTokenPayload;
    try {
      payload = verifyAccessToken(accessToken, this.config.env.SESSION_JWT_SECRET);
    } catch (e) {
      if (e instanceof TokenError) {
        throw new AppError('unauthorized', 'Сессия недействительна, войдите заново');
      }
      throw e;
    }

    const session = await this.prisma.session.findUnique({
      where: { id: payload.sid },
      include: { user: true },
    });

    if (!session || session.userId !== payload.sub) {
      throw new AppError('unauthorized', 'Сессия недействительна, войдите заново');
    }
    // Блокировка проверяется первой: пользователь должен узнать настоящую
    // причину, а не «сессия завершена» после отзыва сессий при бане.
    if (session.user.isBanned) {
      throw new AppError('user_banned', 'Доступ к платформе заблокирован');
    }
    if (session.revokedAt) {
      throw new AppError('session_revoked', 'Сессия завершена, войдите заново');
    }
    if (session.expiresAt.getTime() <= Date.now()) {
      throw new AppError('unauthorized', 'Срок сессии истёк, войдите заново');
    }

    const { user, ...rest } = session;
    return { user, session: rest as Session };
  }

  /**
   * Ротация refresh-токена. Повторное использование уже обменянного токена
   * трактуется как компрометация: все сессии пользователя отзываются.
   */
  async refresh(
    refreshToken: string,
    meta: { userAgent?: string | null; ip?: string | null } = {},
  ): Promise<IssuedSession> {
    const hash = hashRefreshToken(refreshToken);
    const existing = await this.prisma.session.findUnique({
      where: { refreshTokenHash: hash },
      include: { user: true },
    });

    if (!existing) {
      throw new AppError('unauthorized', 'Сессия недействительна, войдите заново');
    }

    if (existing.replacedById) {
      this.logger.warn(
        { userId: existing.userId, sessionId: existing.id },
        'Повторное использование обменянного refresh-токена, отзываю все сессии',
      );
      await this.revokeAllForUser(existing.userId, 'refresh_token_reuse');
      throw new AppError(
        'refresh_reused',
        'Обнаружено повторное использование токена. Все сессии завершены, войдите заново',
      );
    }
    if (existing.revokedAt) {
      throw new AppError('session_revoked', 'Сессия завершена, войдите заново');
    }
    if (existing.expiresAt.getTime() <= Date.now()) {
      throw new AppError('unauthorized', 'Срок сессии истёк, войдите заново');
    }
    if (existing.user.isBanned) {
      throw new AppError('user_banned', 'Доступ к платформе заблокирован');
    }

    return this.prisma.transaction(async (tx) => {
      const { token, hash: newHash } = generateRefreshToken();
      const created = await tx.session.create({
        data: {
          userId: existing.userId,
          kind: existing.kind,
          refreshTokenHash: newHash,
          expiresAt: new Date(Date.now() + this.config.env.REFRESH_TOKEN_TTL_SEC * 1000),
          userAgent: meta.userAgent?.slice(0, 500) ?? existing.userAgent,
          ip: meta.ip ?? existing.ip,
        },
      });
      await tx.session.update({
        where: { id: existing.id },
        data: { revokedAt: new Date(), revokeReason: 'rotated', replacedById: created.id },
      });
      return {
        ...this.buildAccess(existing.userId, created.id, created.kind),
        refreshToken: token,
        sessionId: created.id,
      };
    });
  }

  async revoke(sessionId: string, reason = 'logout'): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: reason },
    });
  }

  async revokeAllForUser(userId: string, reason = 'logout_all'): Promise<number> {
    const result = await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: reason },
    });
    return result.count;
  }

  async listActive(userId: string): Promise<Session[]> {
    return this.prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: 'desc' },
    });
  }

  async touch(sessionId: string): Promise<void> {
    await this.prisma.session
      .update({ where: { id: sessionId }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);
  }

  /** Удаление просроченных сессий (фоновая задача). */
  async cleanupExpired(): Promise<number> {
    const result = await this.prisma.session.deleteMany({
      where: { expiresAt: { lt: new Date(Date.now() - 7 * 86_400_000) } },
    });
    return result.count;
  }
}
