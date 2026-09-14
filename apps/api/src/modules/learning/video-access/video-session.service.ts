import { Injectable, Logger } from '@nestjs/common';
import type { Prisma, VideoSessionRevokeReason, VideoViewSession } from '@prisma/client';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { AppConfigService } from '@/config/config.service';
import { AppError } from '@/common/errors/app.error';
import { signAccessToken, verifyAccessToken, TokenError } from '@/modules/auth/tokens';
import type { PlaybackCapabilities } from '@/infra/video/video.types';
import { buildWatermark } from './video-watermark';

export interface IssueSessionInput {
  userId: string;
  enrollmentId: string;
  lessonKey: string;
  videoAssetId: string;
  capabilities: PlaybackCapabilities;
  ip?: string | null;
  userAgent?: string | null;
}

export interface IssuedSession {
  session: VideoViewSession;
  authToken: string;
  drm: boolean;
  watermark: string | null;
}

export type AuthorizeOutcome =
  { allowed: true; session: VideoViewSession } | { allowed: false; reason: string };

/**
 * Сессии просмотра урока.
 *
 * Смысл в том, что выданный клиенту адрес плеера сам по себе ничего не
 * открывает: провайдер спрашивает у нас разрешение по токену сессии, а мы на
 * каждый такой запрос заново проверяем права. Поэтому отзыв доступа закрывает
 * и уже открытый плеер, а не только следующий вход.
 */
@Injectable()
export class VideoSessionService {
  private readonly logger = new Logger(VideoSessionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  private get secret(): string {
    // На разработке и в тестах секрета может не быть: подписываем сессионным,
    // чтобы окружение поднималось. В production пустой секрет запрещён
    // проверкой конфигурации.
    return this.config.env.VIDEO_TOKEN_SECRET || this.config.env.SESSION_JWT_SECRET;
  }

  /**
   * Какой режим выдать.
   *
   * DRM включается только если он разрешён настройкой и клиент подтвердил, что
   * умеет его проигрывать. Telegram открывает Mini App в системном WebView, где
   * защищённое воспроизведение доступно не везде, и молча отдавать туда
   * зашифрованный поток — значит показать пользователю чёрный экран.
   */
  decideDrm(capabilities: PlaybackCapabilities): boolean {
    if (!this.config.env.VIDEO_DRM_ENABLED) return false;
    return capabilities.widevine || capabilities.fairplay || capabilities.playready;
  }

  async issue(input: IssueSessionInput): Promise<IssuedSession> {
    const drm = this.decideDrm(input.capabilities);
    const watermark = this.config.env.VIDEO_WATERMARK_ENABLED
      ? buildWatermark(input.userId, this.secret)
      : '';
    const ttlSec = this.config.env.VIDEO_SESSION_TTL_SEC;
    const expiresAt = new Date(Date.now() + ttlSec * 1000);

    const session = await this.prisma.transaction(async (tx) => {
      // Одна действующая сессия на урок: открытие на втором устройстве
      // закрывает первый плеер. Частичный уникальный индекс в базе не даст
      // создать вторую, даже если сюда придут два запроса разом.
      await tx.videoViewSession.updateMany({
        where: { enrollmentId: input.enrollmentId, lessonKey: input.lessonKey, revokedAt: null },
        data: { revokedAt: new Date(), revokeReason: 'superseded' },
      });

      return tx.videoViewSession.create({
        data: {
          userId: input.userId,
          enrollmentId: input.enrollmentId,
          lessonKey: input.lessonKey,
          videoAssetId: input.videoAssetId,
          watermark,
          drm,
          capabilities: input.capabilities as unknown as Prisma.InputJsonValue,
          expiresAt,
          ip: input.ip ?? null,
          userAgent: input.userAgent?.slice(0, 500) ?? null,
        },
      });
    });

    const authToken = signAccessToken(
      { sub: input.userId, sid: session.id, kind: 'miniapp' },
      this.secret,
      ttlSec,
    );

    return { session, authToken, drm, watermark: watermark || null };
  }

  /**
   * Проверка запроса провайдера.
   *
   * Токен только указывает на сессию. Права проверяются заново по базе:
   * между выдачей токена и запросом лицензии доступ мог закончиться.
   */
  async authorize(
    token: string,
    meta: { ip?: string | null; userAgent?: string | null } = {},
    recheck?: (session: VideoViewSession) => Promise<boolean>,
  ): Promise<AuthorizeOutcome> {
    let sessionId: string;
    let userId: string;
    try {
      const payload = verifyAccessToken(token, this.secret);
      sessionId = payload.sid;
      userId = payload.sub;
    } catch (err) {
      return { allowed: false, reason: err instanceof TokenError ? err.reason : 'malformed' };
    }

    const session = await this.prisma.videoViewSession.findUnique({ where: { id: sessionId } });
    if (!session) return { allowed: false, reason: 'session_not_found' };

    // Токен подписан нами, но сверка владельца всё равно нужна: она ловит
    // случай, когда сессию подменили в базе или токен собрали из чужих частей.
    if (session.userId !== userId) return { allowed: false, reason: 'user_mismatch' };
    if (session.revokedAt) return { allowed: false, reason: 'revoked' };
    if (session.expiresAt.getTime() <= Date.now()) return { allowed: false, reason: 'expired' };

    if (recheck && !(await recheck(session))) {
      await this.revokeById(session.id, 'lesson_closed');
      return { allowed: false, reason: 'access_lost' };
    }

    const updated = await this.prisma.videoViewSession.update({
      where: { id: session.id },
      data: {
        checkCount: { increment: 1 },
        lastCheckAt: new Date(),
        ip: meta.ip ?? session.ip,
        userAgent: meta.userAgent?.slice(0, 500) ?? session.userAgent,
      },
    });
    return { allowed: true, session: updated };
  }

  async revokeById(sessionId: string, reason: VideoSessionRevokeReason): Promise<void> {
    await this.prisma.videoViewSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: reason },
    });
  }

  /** Отзыв всех действующих сессий пользователя: доступ закончился. */
  async revokeForUser(userId: string, reason: VideoSessionRevokeReason): Promise<number> {
    const { count } = await this.prisma.videoViewSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: reason },
    });
    if (count > 0) this.logger.log({ userId, count, reason }, 'Отозваны сессии просмотра');
    return count;
  }

  async revokeForEnrollment(
    enrollmentId: string,
    reason: VideoSessionRevokeReason,
  ): Promise<number> {
    const { count } = await this.prisma.videoViewSession.updateMany({
      where: { enrollmentId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: reason },
    });
    return count;
  }

  async getById(sessionId: string): Promise<VideoViewSession> {
    const session = await this.prisma.videoViewSession.findUnique({ where: { id: sessionId } });
    if (!session) throw AppError.notFound('Сессия просмотра не найдена');
    return session;
  }
}
