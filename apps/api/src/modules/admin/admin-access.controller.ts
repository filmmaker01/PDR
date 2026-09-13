import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AccessGrant } from '@prisma/client';
import { zodBody } from '@/common/pipes/zod-validation.pipe';
import { AppError } from '@/common/errors/app.error';
import {
  CurrentAuth,
  PlatformRoles,
  type AuthContext,
} from '@/modules/auth/decorators/auth.decorators';
import { AccessService } from '@/modules/access/access.service';
import { Audited } from '@/modules/audit/audit.interceptor';
import { NotificationsService } from '@/modules/notifications/notifications.service';
import {
  createGrantSchema,
  extendGrantSchema,
  listGrantsQuerySchema,
  revokeGrantSchema,
} from './dto/admin.dto';

const PRODUCT_LABELS: Record<string, string> = {
  course: 'Доступ к курсу',
  crm: 'Доступ к CRM мастерской',
  club: 'Доступ к закрытому клубу',
};

function serialize(grant: AccessGrant): Record<string, unknown> {
  return {
    id: grant.id,
    product: grant.product,
    subjectType: grant.subjectType,
    userId: grant.userId,
    workspaceId: grant.workspaceId,
    courseId: grant.courseId,
    status: grant.status,
    validFrom: grant.validFrom.toISOString(),
    validUntil: grant.validUntil?.toISOString() ?? null,
    source: grant.source,
    externalRef: grant.externalRef,
    reason: grant.reason,
    createdAt: grant.createdAt.toISOString(),
  };
}

@ApiTags('admin')
@Controller('admin/access-grants')
@PlatformRoles('admin')
export class AdminAccessController {
  constructor(
    private readonly access: AccessService,
    private readonly notifications: NotificationsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Список доступов с фильтрами' })
  async list(@Query() query: Record<string, string>) {
    const parsed = listGrantsQuerySchema.parse(query);
    const result = await this.access.listAll({
      product: parsed.product,
      status: parsed.status,
      userId: parsed.userId,
      workspaceId: parsed.workspaceId,
      expiringBefore: parsed.expiringInDays
        ? new Date(Date.now() + parsed.expiringInDays * 86_400_000)
        : undefined,
      limit: parsed.limit,
      cursor: parsed.cursor,
    });
    return { items: result.items.map(serialize), nextCursor: result.nextCursor };
  }

  @Post()
  @Audited({ entityType: 'access_grant', action: 'grant', idFrom: { responseField: 'id' } })
  @ApiOperation({ summary: 'Выдача доступа' })
  async create(
    @CurrentAuth() auth: AuthContext,
    @Body(zodBody(createGrantSchema)) body: Record<string, never>,
  ) {
    const input = body as unknown as {
      product: 'course' | 'crm' | 'club';
      userId?: string;
      workspaceId?: string;
      courseId?: string;
      validFrom?: Date;
      validUntil?: Date | null;
      source: 'manual' | 'promo' | 'migration' | 'payment';
      externalRef?: string | null;
      reason?: string | null;
    };
    const grant = await this.access.create({ ...input, grantedById: auth.user.id });
    return serialize(grant);
  }

  @Post(':grantId/extend')
  @Audited({ entityType: 'access_grant', action: 'extend', idFrom: { param: 'grantId' } })
  @ApiOperation({ summary: 'Продление доступа' })
  async extend(
    @Param('grantId') grantId: string,
    @Body(zodBody(extendGrantSchema)) body: { validUntil: Date | null; reason: string },
  ) {
    assertUuid(grantId);
    return serialize(await this.access.extend(grantId, body.validUntil, body.reason));
  }

  @Post(':grantId/revoke')
  @Audited({ entityType: 'access_grant', action: 'revoke', idFrom: { param: 'grantId' } })
  @ApiOperation({ summary: 'Отзыв доступа' })
  async revoke(
    @CurrentAuth() auth: AuthContext,
    @Param('grantId') grantId: string,
    @Body(zodBody(revokeGrantSchema)) body: { reason: string },
  ) {
    assertUuid(grantId);
    const grant = await this.access.revoke(grantId, auth.user.id, body.reason);

    // Пользователь должен узнать об отзыве, не обнаружив его в интерфейсе.
    if (grant.userId) {
      await this.notifications.notify({
        userId: grant.userId,
        type: 'access_revoked',
        payload: { productLabel: PRODUCT_LABELS[grant.product], reason: body.reason },
        dedupeKey: `access_revoked:${grant.id}`,
      });
    }
    return serialize(grant);
  }

  @Post(':grantId/suspend')
  @Audited({ entityType: 'access_grant', action: 'suspend', idFrom: { param: 'grantId' } })
  @ApiOperation({ summary: 'Приостановка доступа' })
  async suspend(
    @Param('grantId') grantId: string,
    @Body(zodBody(revokeGrantSchema)) body: { reason: string },
  ) {
    assertUuid(grantId);
    return serialize(await this.access.suspend(grantId, body.reason));
  }

  @Post(':grantId/resume')
  @Audited({ entityType: 'access_grant', action: 'resume', idFrom: { param: 'grantId' } })
  @ApiOperation({ summary: 'Возобновление доступа' })
  async resume(
    @Param('grantId') grantId: string,
    @Body(zodBody(revokeGrantSchema)) body: { reason: string },
  ) {
    assertUuid(grantId);
    return serialize(await this.access.resume(grantId, body.reason));
  }
}

function assertUuid(value: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw AppError.notFound('Доступ не найден');
  }
}
