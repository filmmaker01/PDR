import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Export } from '@prisma/client';
import { z } from 'zod';
import { EXPORT_KINDS } from '@pdr/shared';
import { zodBody } from '@/common/pipes/zod-validation.pipe';
import { AppError } from '@/common/errors/app.error';
import {
  CurrentAuth,
  PlatformRoles,
  type AuthContext,
} from '@/modules/auth/decorators/auth.decorators';
import { Audited } from '@/modules/audit/audit.interceptor';
import { AllowExpiredAccess, Can, Workspace } from '@/modules/workspaces/guards/workspace.guard';
import { Ws } from '@/modules/workspaces/decorators/workspace.decorators';
import type { WorkspaceContext } from '@/modules/workspaces/workspace.types';
import { ExportService } from './export.service';

const crmExportSchema = z
  .object({
    kind: z.enum(['crm_full', 'crm_clients', 'crm_orders', 'crm_payments']).default('crm_full'),
    includePhotos: z.boolean().optional(),
  })
  .strict();

const adminExportSchema = z
  .object({
    kind: z.enum(['learning_students', 'learning_progress', 'audit']),
    cohortId: z.string().uuid().optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
  })
  .strict();

function serialize(record: Export): Record<string, unknown> {
  return {
    id: record.id,
    kind: record.kind,
    status: record.status,
    rowCount: record.rowCount,
    error: record.error,
    createdAt: record.createdAt.toISOString(),
    finishedAt: record.finishedAt?.toISOString() ?? null,
    ready: record.status === 'done',
  };
}

@ApiTags('export')
@Controller('workspaces/:workspaceId/exports')
@Workspace()
export class WorkspaceExportController {
  constructor(private readonly exports: ExportService) {}

  @Get()
  @Can('export.run')
  @AllowExpiredAccess()
  @ApiOperation({ summary: 'Выгрузки мастерской' })
  async list(@Ws() ws: WorkspaceContext, @CurrentAuth() auth: AuthContext) {
    const items = await this.exports.listFor(auth.user.id, ws.workspaceId);
    return items.map(serialize);
  }

  @Post()
  @Can('export.run')
  // Выгрузка доступна и после окончания доступа: владелец не должен терять
  // собственную клиентскую базу вместе с подпиской.
  @AllowExpiredAccess()
  @Audited({ entityType: 'export', action: 'create', idFrom: { responseField: 'id' } })
  @ApiOperation({ summary: 'Заказать выгрузку данных мастерской' })
  async create(
    @Ws() ws: WorkspaceContext,
    @CurrentAuth() auth: AuthContext,
    @Body(zodBody(crmExportSchema)) body: { kind: never; includePhotos?: boolean },
  ) {
    const record = await this.exports.request({
      kind: body.kind,
      requestedById: auth.user.id,
      workspaceId: ws.workspaceId,
      params: { includePhotos: body.includePhotos ?? false },
    });
    return serialize(record);
  }

  @Get(':exportId')
  @Can('export.run')
  @AllowExpiredAccess()
  @ApiOperation({ summary: 'Состояние выгрузки' })
  async get(@CurrentAuth() auth: AuthContext, @Param('exportId') exportId: string) {
    return serialize(await this.exports.getById(exportId, auth.user.id));
  }

  @Get(':exportId/download')
  @Can('export.run')
  @AllowExpiredAccess()
  @ApiOperation({ summary: 'Ссылка на скачивание выгрузки' })
  async download(@CurrentAuth() auth: AuthContext, @Param('exportId') exportId: string) {
    return this.exports.downloadUrl(exportId, auth.user, auth.platformRoles);
  }
}

@ApiTags('admin')
@Controller('admin/exports')
@PlatformRoles('admin')
export class AdminExportController {
  constructor(private readonly exports: ExportService) {}

  @Get()
  @ApiOperation({ summary: 'Выгрузки администратора' })
  async list(@CurrentAuth() auth: AuthContext) {
    const items = await this.exports.listFor(auth.user.id);
    return items.map(serialize);
  }

  @Post()
  @Audited({ entityType: 'export', action: 'create', idFrom: { responseField: 'id' } })
  @ApiOperation({ summary: 'Заказать выгрузку по обучению или журналу' })
  async create(
    @CurrentAuth() auth: AuthContext,
    @Body(zodBody(adminExportSchema)) body: Record<string, never>,
  ) {
    const { kind, ...params } = body as unknown as { kind: (typeof EXPORT_KINDS)[number] };
    if (!this.exports.isAdminKind(kind)) {
      throw AppError.validation('Эта выгрузка заказывается в мастерской');
    }
    const record = await this.exports.request({
      kind,
      requestedById: auth.user.id,
      params: params as Record<string, unknown>,
    });
    return serialize(record);
  }

  @Get(':exportId/download')
  @ApiOperation({ summary: 'Ссылка на скачивание выгрузки' })
  async download(@CurrentAuth() auth: AuthContext, @Param('exportId') exportId: string) {
    return this.exports.downloadUrl(exportId, auth.user, auth.platformRoles);
  }
}
