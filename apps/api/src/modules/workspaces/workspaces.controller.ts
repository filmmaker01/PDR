import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { zodBody } from '@/common/pipes/zod-validation.pipe';
import { AppError } from '@/common/errors/app.error';
import { CurrentAuth, type AuthContext } from '@/modules/auth/decorators/auth.decorators';
import { TelegramService } from '@/infra/telegram/telegram.service';
import { FilesService } from '@/modules/files/files.service';
import { AppConfigService } from '@/config/config.service';
import { Audited } from '@/modules/audit/audit.interceptor';
import { AuditService } from '@/modules/audit/audit.service';
import { z } from 'zod';
import { WorkspacesService } from './workspaces.service';
import { InvitationsService } from './invitations.service';
import { AllowExpiredAccess, Can, Workspace } from './guards/workspace.guard';
import { Ws } from './decorators/workspace.decorators';
import type { WorkspaceContext } from './workspace.types';
import {
  createInvitationSchema,
  transferOwnershipSchema,
  updateMemberSchema,
  updateWorkspaceSchema,
} from './dto/workspaces.dto';

const auditQuerySchema = z.object({
  entityType: z.string().max(60).optional(),
  entityId: z.string().max(60).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  cursor: z.string().optional(),
});

@ApiTags('workspaces')
@Controller('workspaces/:workspaceId')
@Workspace()
export class WorkspacesController {
  constructor(
    private readonly workspaces: WorkspacesService,
    private readonly invitations: InvitationsService,
    private readonly telegram: TelegramService,
    private readonly audit: AuditService,
    private readonly files: FilesService,
    private readonly config: AppConfigService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Мастерская: настройки, роль, состояние доступа' })
  async get(@Ws() ws: WorkspaceContext) {
    const usedBytes = await this.files.workspaceUsageBytes(ws.workspaceId);
    const quotaBytes = this.config.env.STORAGE_WORKSPACE_QUOTA_MB * 1024 * 1024;

    return {
      id: ws.workspace.id,
      name: ws.workspace.name,
      timezone: ws.workspace.timezone,
      currency: ws.workspace.currency,
      phone: ws.workspace.phone,
      address: ws.workspace.address,
      settings: ws.settings,
      role: ws.role,
      memberId: ws.member.id,
      permissions: [...ws.permissions],
      access: {
        active: ws.hasActiveAccess,
        validUntil: ws.accessValidUntil?.toISOString() ?? null,
      },
      storage: {
        usedBytes,
        quotaBytes,
        // Предупреждение показывается заранее, а не в момент отказа загрузки.
        warn: quotaBytes > 0 && usedBytes > quotaBytes * 0.8,
      },
    };
  }

  @Patch()
  @Can('workspace.manage')
  @Audited({ entityType: 'workspace', idFrom: { param: 'workspaceId' } })
  @ApiOperation({ summary: 'Изменение настроек мастерской' })
  async update(
    @Ws() ws: WorkspaceContext,
    @Body(zodBody(updateWorkspaceSchema)) body: Record<string, unknown>,
  ) {
    const updated = await this.workspaces.update(ws.workspaceId, body);
    return { id: updated.id, name: updated.name, timezone: updated.timezone };
  }

  @Get('audit')
  @Can('audit.read')
  @AllowExpiredAccess()
  @ApiOperation({ summary: 'Журнал действий мастерской' })
  async auditLog(@Ws() ws: WorkspaceContext, @Query() query: Record<string, string>) {
    const parsed = auditQuerySchema.parse(query);
    const result = await this.audit.listWorkspace(ws.workspaceId, parsed);
    return {
      items: result.items.map((row) => ({
        id: row.id.toString(),
        createdAt: row.createdAt.toISOString(),
        actorUserId: row.actorUserId,
        actorRoleContext: row.actorRoleContext,
        entityType: row.entityType,
        entityId: row.entityId,
        action: row.action,
        before: row.before,
        after: row.after,
      })),
      nextCursor: result.nextCursor,
    };
  }

  @Get('members')
  @Can('members.read')
  @AllowExpiredAccess()
  @ApiOperation({ summary: 'Сотрудники мастерской' })
  async members(@Ws() ws: WorkspaceContext) {
    const members = await this.workspaces.listMembers(ws.workspaceId);
    return members.map((m) => ({
      id: m.id,
      userId: m.userId,
      role: m.role,
      name: m.displayName ?? [m.user.firstName, m.user.lastName].filter(Boolean).join(' '),
      username: m.user.username,
      color: m.color,
      isActive: m.isActive,
      joinedAt: m.joinedAt.toISOString(),
    }));
  }

  @Patch('members/:memberId')
  @Can('members.manage')
  @Audited({ entityType: 'workspace_member', idFrom: { param: 'memberId' } })
  @ApiOperation({ summary: 'Изменение сотрудника' })
  async updateMember(
    @Ws() ws: WorkspaceContext,
    @Param('memberId') memberId: string,
    @Body(zodBody(updateMemberSchema)) body: Record<string, unknown>,
  ) {
    const member = await this.workspaces.updateMember(ws.workspaceId, memberId, body);
    return { id: member.id, isActive: member.isActive };
  }

  @Post('members/transfer-ownership')
  @Can('members.manage')
  @Audited({
    entityType: 'workspace',
    action: 'transfer_ownership',
    idFrom: { param: 'workspaceId' },
  })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Передача владения мастерской' })
  async transferOwnership(
    @Ws() ws: WorkspaceContext,
    @Body(zodBody(transferOwnershipSchema)) body: { memberId: string },
  ): Promise<void> {
    await this.workspaces.transferOwnership(ws.workspaceId, ws.userId, body.memberId);
  }

  @Get('invitations')
  @Can('members.manage')
  @ApiOperation({ summary: 'Активные приглашения' })
  async listInvitations(@Ws() ws: WorkspaceContext) {
    const invitations = await this.invitations.listActive(ws.workspaceId);
    return invitations.map((i) => ({
      id: i.id,
      role: i.role,
      invitedPhone: i.invitedPhone,
      note: i.note,
      expiresAt: i.expiresAt.toISOString(),
      createdAt: i.createdAt.toISOString(),
    }));
  }

  @Post('invitations')
  @Can('members.manage')
  @Audited({ entityType: 'invitation', action: 'create', idFrom: { responseField: 'id' } })
  @ApiOperation({ summary: 'Создание приглашения сотрудника' })
  async createInvitation(
    @Ws() ws: WorkspaceContext,
    @CurrentAuth() auth: AuthContext,
    @Body(zodBody(createInvitationSchema))
    body: { role: 'employee'; expiresInDays: number; phone?: string | null; note?: string | null },
  ) {
    const created = await this.invitations.create({
      workspaceId: ws.workspaceId,
      role: body.role,
      createdById: auth.user.id,
      expiresInDays: body.expiresInDays,
      phone: body.phone ?? null,
      note: body.note ?? null,
    });
    return {
      id: created.invitation.id,
      expiresAt: created.invitation.expiresAt.toISOString(),
      // Ссылка содержит токен и показывается один раз.
      deepLink: this.telegram.miniAppLink(created.startParam),
      botLink: this.telegram.botLink(created.startParam),
    };
  }

  @Delete('invitations/:invitationId')
  @Can('members.manage')
  @Audited({ entityType: 'invitation', action: 'revoke', idFrom: { param: 'invitationId' } })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Отзыв приглашения' })
  async revokeInvitation(
    @Ws() ws: WorkspaceContext,
    @Param('invitationId') invitationId: string,
  ): Promise<void> {
    if (!/^[0-9a-f-]{36}$/i.test(invitationId)) throw AppError.notFound('Приглашение не найдено');
    await this.invitations.revoke(ws.workspaceId, invitationId);
  }
}
