import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { PlatformRoles } from '@/modules/auth/decorators/auth.decorators';
import { AuditService } from '@/modules/audit/audit.service';

const querySchema = z.object({
  actorUserId: z.string().uuid().optional(),
  entityType: z.string().max(60).optional(),
  entityId: z.string().max(60).optional(),
  action: z.string().max(60).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  cursor: z.string().optional(),
});

@ApiTags('admin')
@Controller('admin/audit')
@PlatformRoles('admin')
export class AdminAuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @ApiOperation({
    summary: 'Платформенный журнал действий (данные мастерских маскируются)',
  })
  async list(@Query() query: Record<string, string>) {
    const parsed = querySchema.parse(query);
    const result = await this.audit.listPlatform(parsed);
    return {
      items: result.items.map((row) => ({
        id: row.id.toString(),
        createdAt: row.createdAt.toISOString(),
        actorUserId: row.actorUserId,
        actorRoleContext: row.actorRoleContext,
        workspaceId: row.workspaceId,
        entityType: row.entityType,
        entityId: row.entityId,
        action: row.action,
        before: row.before,
        after: row.after,
        requestId: row.requestId,
        ip: row.ip,
      })),
      nextCursor: result.nextCursor,
    };
  }
}
