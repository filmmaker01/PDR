import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { PlatformRoleName } from '@prisma/client';
import { normalizePhone } from '@pdr/shared';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { zodBody } from '@/common/pipes/zod-validation.pipe';
import { AppError } from '@/common/errors/app.error';
import {
  CurrentAuth,
  PlatformRoles,
  type AuthContext,
} from '@/modules/auth/decorators/auth.decorators';
import { UsersService } from '@/modules/users/users.service';
import { SessionService } from '@/modules/auth/session.service';
import { AccessService } from '@/modules/access/access.service';
import { Audited } from '@/modules/audit/audit.interceptor';
import { banUserSchema, platformRoleSchema, userSearchQuerySchema } from './dto/admin.dto';

@ApiTags('admin')
@Controller('admin/users')
@PlatformRoles('admin')
export class AdminUsersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly sessions: SessionService,
    private readonly access: AccessService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Поиск пользователей по имени, username, телефону или Telegram ID' })
  async search(@Query() query: Record<string, string>) {
    const { q, limit } = userSearchQuerySchema.parse(query);
    const term = q?.trim();
    const telegramId = term && /^\d{5,15}$/.test(term) ? BigInt(term) : null;
    const phone = term ? normalizePhone(term) : null;

    const users = await this.prisma.user.findMany({
      where: term
        ? {
            OR: [
              { firstName: { contains: term, mode: 'insensitive' } },
              { lastName: { contains: term, mode: 'insensitive' } },
              { username: { contains: term.replace(/^@/, ''), mode: 'insensitive' } },
              ...(telegramId ? [{ telegramUserId: telegramId }] : []),
              ...(phone ? [{ phone }] : []),
            ],
          }
        : {},
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { platformRoles: { select: { role: true } } },
    });

    return users.map((u) => ({
      id: u.id,
      telegramUserId: u.telegramUserId.toString(),
      firstName: u.firstName,
      lastName: u.lastName,
      username: u.username,
      phone: u.phone,
      isBanned: u.isBanned,
      botWriteAllowed: u.botWriteAllowed,
      platformRoles: u.platformRoles.map((r) => r.role),
      createdAt: u.createdAt.toISOString(),
    }));
  }

  @Get(':userId')
  @ApiOperation({ summary: 'Карточка пользователя (без данных CRM его мастерских)' })
  async get(@Param('userId') userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        platformRoles: { select: { role: true } },
        workspaceMemberships: {
          include: { workspace: { select: { id: true, name: true, archivedAt: true } } },
        },
      },
    });
    if (!user) throw AppError.notFound('Пользователь не найден');

    const grants = await this.access.listAll({ userId, limit: 100 });
    const sessions = await this.sessions.listActive(userId);

    return {
      id: user.id,
      telegramUserId: user.telegramUserId.toString(),
      firstName: user.firstName,
      lastName: user.lastName,
      username: user.username,
      phone: user.phone,
      email: user.email,
      isBanned: user.isBanned,
      banReason: user.banReason,
      botWriteAllowed: user.botWriteAllowed,
      isBotBlocked: user.isBotBlocked,
      lastSeenAt: user.lastSeenAt?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
      platformRoles: user.platformRoles.map((r) => r.role),
      // Администратор видит факт участия, но не содержимое CRM.
      workspaces: user.workspaceMemberships.map((m) => ({
        id: m.workspace.id,
        name: m.workspace.name,
        role: m.role,
        isActive: m.isActive,
      })),
      grants: grants.items.map((g) => ({
        id: g.id,
        product: g.product,
        status: g.status,
        validUntil: g.validUntil?.toISOString() ?? null,
      })),
      activeSessions: sessions.length,
    };
  }

  @Post(':userId/platform-roles')
  @Audited({ entityType: 'user', action: 'grant_role', idFrom: { param: 'userId' } })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Назначение роли платформы' })
  async grantRole(
    @CurrentAuth() auth: AuthContext,
    @Param('userId') userId: string,
    @Body(zodBody(platformRoleSchema)) body: { role: PlatformRoleName },
  ): Promise<void> {
    await this.users.getById(userId);
    await this.users.grantPlatformRole(userId, body.role, auth.user.id);
  }

  @Delete(':userId/platform-roles/:role')
  @Audited({ entityType: 'user', action: 'revoke_role', idFrom: { param: 'userId' } })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Снятие роли платформы' })
  async revokeRole(
    @CurrentAuth() auth: AuthContext,
    @Param('userId') userId: string,
    @Param('role') role: string,
  ): Promise<void> {
    if (role !== 'admin' && role !== 'curator') throw AppError.notFound('Роль не найдена');
    if (role === 'admin' && userId === auth.user.id) {
      throw AppError.conflict('Нельзя снять роль администратора с самого себя');
    }
    if (role === 'admin') await this.assertNotLastAdmin(userId);
    await this.users.revokePlatformRole(userId, role);
  }

  @Post(':userId/ban')
  @Audited({ entityType: 'user', action: 'ban', idFrom: { param: 'userId' } })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Блокировка пользователя с отзывом сессий' })
  async ban(
    @CurrentAuth() auth: AuthContext,
    @Param('userId') userId: string,
    @Body(zodBody(banUserSchema)) body: { reason: string },
  ): Promise<void> {
    if (userId === auth.user.id) throw AppError.conflict('Нельзя заблокировать самого себя');
    await this.users.getById(userId);
    await this.users.setBanned(userId, true, body.reason);
    await this.sessions.revokeAllForUser(userId, 'banned');
  }

  @Post(':userId/unban')
  @Audited({ entityType: 'user', action: 'unban', idFrom: { param: 'userId' } })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Снятие блокировки' })
  async unban(@Param('userId') userId: string): Promise<void> {
    await this.users.getById(userId);
    await this.users.setBanned(userId, false, null);
  }

  @Post(':userId/revoke-sessions')
  @Audited({ entityType: 'user', action: 'revoke_sessions', idFrom: { param: 'userId' } })
  @ApiOperation({ summary: 'Отзыв всех сессий пользователя' })
  async revokeSessions(@Param('userId') userId: string): Promise<{ revoked: number }> {
    await this.users.getById(userId);
    return { revoked: await this.sessions.revokeAllForUser(userId, 'admin_revoke') };
  }

  private async assertNotLastAdmin(userId: string): Promise<void> {
    const admins = await this.prisma.platformRole.count({ where: { role: 'admin' } });
    const isAdmin = await this.users.hasPlatformRole(userId, 'admin');
    if (isAdmin && admins <= 1) {
      throw AppError.conflict('Нельзя снять роль у последнего администратора');
    }
  }
}
