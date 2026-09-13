import { Injectable } from '@nestjs/common';
import type { PlatformRoleName, Prisma, User } from '@prisma/client';
import { normalizePhone } from '@pdr/shared';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { AppError } from '@/common/errors/app.error';
import type { TelegramUserPayload } from '@/infra/telegram/init-data';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Создаёт или обновляет пользователя по данным Telegram.
   * username и фото — справочные поля, могут меняться в любой момент.
   * Телефон из авторизации не приходит и здесь не трогается.
   */
  async upsertFromTelegram(payload: TelegramUserPayload): Promise<User> {
    const telegramUserId = BigInt(payload.id);
    const common = {
      firstName: payload.firstName || 'Пользователь',
      lastName: payload.lastName,
      username: payload.username,
      languageCode: payload.languageCode,
      photoUrl: payload.photoUrl,
      lastSeenAt: new Date(),
    };

    return this.prisma.user.upsert({
      where: { telegramUserId },
      create: {
        telegramUserId,
        ...common,
        botWriteAllowed: payload.allowsWriteToPm,
      },
      update: {
        ...common,
        // Разрешение можно только получить: отсутствие флага в одном запросе
        // не означает, что пользователь отозвал доступ.
        ...(payload.allowsWriteToPm ? { botWriteAllowed: true, isBotBlocked: false } : {}),
      },
    });
  }

  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async getById(id: string): Promise<User> {
    const user = await this.findById(id);
    if (!user) throw AppError.notFound('Пользователь не найден');
    return user;
  }

  async findByTelegramId(telegramUserId: bigint): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { telegramUserId } });
  }

  async platformRoles(userId: string): Promise<PlatformRoleName[]> {
    const rows = await this.prisma.platformRole.findMany({
      where: { userId },
      select: { role: true },
    });
    return rows.map((r) => r.role);
  }

  async hasPlatformRole(userId: string, role: PlatformRoleName): Promise<boolean> {
    const row = await this.prisma.platformRole.findUnique({
      where: { userId_role: { userId, role } },
      select: { userId: true },
    });
    return row !== null;
  }

  async grantPlatformRole(
    userId: string,
    role: PlatformRoleName,
    grantedById: string | null,
  ): Promise<void> {
    await this.prisma.platformRole.upsert({
      where: { userId_role: { userId, role } },
      create: { userId, role, grantedById },
      update: {},
    });
  }

  async revokePlatformRole(userId: string, role: PlatformRoleName): Promise<void> {
    await this.prisma.platformRole
      .delete({ where: { userId_role: { userId, role } } })
      .catch(() => undefined);
  }

  async updateProfile(
    userId: string,
    input: { phone?: string | null; email?: string | null; languageCode?: string | null },
  ): Promise<User> {
    const data: Prisma.UserUpdateInput = {};
    if (input.phone !== undefined) {
      if (input.phone === null || input.phone === '') {
        data.phone = null;
      } else {
        const normalized = normalizePhone(input.phone);
        if (!normalized) throw AppError.validation('Не удалось разобрать номер телефона');
        data.phone = normalized;
      }
    }
    if (input.email !== undefined) data.email = input.email;
    if (input.languageCode !== undefined) data.languageCode = input.languageCode;

    return this.prisma.user.update({ where: { id: userId }, data });
  }

  async markBotWriteAllowed(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { botWriteAllowed: true, isBotBlocked: false },
    });
  }

  async markBotBlocked(userId: string): Promise<void> {
    await this.prisma.user.update({ where: { id: userId }, data: { isBotBlocked: true } });
  }

  async setBanned(userId: string, banned: boolean, reason: string | null): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { isBanned: banned, banReason: banned ? reason : null },
    });
  }

  async touchLastSeen(userId: string): Promise<void> {
    await this.prisma.user
      .update({ where: { id: userId }, data: { lastSeenAt: new Date() } })
      .catch(() => undefined);
  }
}
