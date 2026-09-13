import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { zodBody } from '@/common/pipes/zod-validation.pipe';
import { AppError } from '@/common/errors/app.error';
import {
  CurrentAuth,
  PlatformRoles,
  type AuthContext,
} from '@/modules/auth/decorators/auth.decorators';
import { WorkspacesService } from '@/modules/workspaces/workspaces.service';
import { AccessService } from '@/modules/access/access.service';
import { createWorkspaceSchema } from './dto/admin.dto';

const listQuery = z.object({
  q: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const patchSchema = z
  .object({ name: z.string().trim().min(1).max(120).optional(), archived: z.boolean().optional() })
  .strict();

/**
 * Управление мастерскими для администратора платформы.
 * Здесь нет и не может быть содержимого CRM: только состав участников,
 * состояние доступа и счётчики.
 */
@ApiTags('admin')
@Controller('admin/workspaces')
@PlatformRoles('admin')
export class AdminWorkspacesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly access: AccessService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Список мастерских' })
  async list(@Query() query: Record<string, string>) {
    const { q, limit } = listQuery.parse(query);
    const rows = await this.prisma.workspace.findMany({
      where: q ? { name: { contains: q, mode: 'insensitive' } } : {},
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        members: {
          where: { isActive: true },
          include: { user: { select: { firstName: true, lastName: true, username: true } } },
        },
        grants: { where: { product: 'crm' }, orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });

    return rows.map((w) => {
      const owner = w.members.find((m) => m.role === 'owner');
      const grant = w.grants[0];
      return {
        id: w.id,
        name: w.name,
        timezone: w.timezone,
        currency: w.currency,
        archivedAt: w.archivedAt?.toISOString() ?? null,
        owner: owner
          ? {
              userId: owner.userId,
              name: [owner.user.firstName, owner.user.lastName].filter(Boolean).join(' '),
              username: owner.user.username,
            }
          : null,
        memberCount: w.members.length,
        access: grant
          ? {
              status: grant.status,
              validUntil: grant.validUntil?.toISOString() ?? null,
              grantId: grant.id,
            }
          : null,
        createdAt: w.createdAt.toISOString(),
      };
    });
  }

  @Post()
  @ApiOperation({ summary: 'Создание мастерской с владельцем' })
  async create(
    @CurrentAuth() auth: AuthContext,
    @Body(zodBody(createWorkspaceSchema))
    body: { name: string; ownerUserId: string; timezone: string; currency: string },
  ) {
    const owner = await this.prisma.user.findUnique({ where: { id: body.ownerUserId } });
    if (!owner) throw AppError.notFound('Пользователь не найден');

    const workspace = await this.workspaces.create({
      name: body.name,
      ownerUserId: body.ownerUserId,
      timezone: body.timezone,
      currency: body.currency,
      createdById: auth.user.id,
    });
    return { id: workspace.id, name: workspace.name };
  }

  @Get(':workspaceId')
  @ApiOperation({ summary: 'Карточка мастерской без данных CRM' })
  async get(@Param('workspaceId') workspaceId: string) {
    const workspace = await this.workspaces.getById(workspaceId);
    const members = await this.workspaces.listMembers(workspaceId);
    const grants = await this.access.listAll({ workspaceId, limit: 50 });

    return {
      id: workspace.id,
      name: workspace.name,
      timezone: workspace.timezone,
      currency: workspace.currency,
      settings: WorkspacesService.settingsOf(workspace),
      archivedAt: workspace.archivedAt?.toISOString() ?? null,
      members: members.map((m) => ({
        id: m.id,
        userId: m.userId,
        role: m.role,
        name: [m.user.firstName, m.user.lastName].filter(Boolean).join(' '),
        username: m.user.username,
        isActive: m.isActive,
      })),
      grants: grants.items.map((g) => ({
        id: g.id,
        status: g.status,
        validUntil: g.validUntil?.toISOString() ?? null,
        reason: g.reason,
      })),
    };
  }

  @Patch(':workspaceId')
  @ApiOperation({ summary: 'Переименование или архивирование мастерской' })
  async patch(
    @Param('workspaceId') workspaceId: string,
    @Body(zodBody(patchSchema)) body: { name?: string; archived?: boolean },
  ) {
    await this.workspaces.getById(workspaceId);
    const updated = await this.prisma.workspace.update({
      where: { id: workspaceId },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.archived !== undefined ? { archivedAt: body.archived ? new Date() : null } : {}),
      },
    });
    return {
      id: updated.id,
      name: updated.name,
      archivedAt: updated.archivedAt?.toISOString() ?? null,
    };
  }
}
