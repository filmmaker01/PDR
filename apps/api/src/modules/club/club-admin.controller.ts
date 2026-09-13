import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CLUB_STATUSES } from '@pdr/shared';
import { zodBody } from '@/common/pipes/zod-validation.pipe';
import { PlatformRoles } from '@/modules/auth/decorators/auth.decorators';
import { Audited } from '@/modules/audit/audit.interceptor';
import { ClubService } from './club.service';

const listQuerySchema = z.object({
  status: z.enum(CLUB_STATUSES).optional(),
  withErrors: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

const removeSchema = z.object({ reason: z.string().trim().min(3).max(300) }).strict();

@ApiTags('admin')
@Controller('admin/club')
@PlatformRoles('admin')
export class ClubAdminController {
  constructor(private readonly club: ClubService) {}

  @Get('memberships')
  @ApiOperation({ summary: 'Членства в клубе: статусы и ошибки' })
  async list(@Query() query: Record<string, string>) {
    const parsed = listQuerySchema.parse(query);
    const items = await this.club.list(parsed);
    return items.map((membership) => ({
      userId: membership.userId,
      name: [membership.user.firstName, membership.user.lastName].filter(Boolean).join(' '),
      username: membership.user.username,
      // BigInt не сериализуется в JSON: отдаём строкой.
      telegramUserId: String(membership.user.telegramUserId),
      status: membership.telegramStatus,
      joinRequestAt: membership.joinRequestAt?.toISOString() ?? null,
      joinedAt: membership.joinedAt?.toISOString() ?? null,
      removedAt: membership.removedAt?.toISOString() ?? null,
      lastError: membership.lastError,
      updatedAt: membership.updatedAt.toISOString(),
    }));
  }

  @Get('events')
  @ApiOperation({ summary: 'События клуба: заявки, одобрения, ошибки' })
  async events(@Query('userId') userId?: string) {
    const items = await this.club.events(userId, 100);
    return items.map((event) => ({
      id: event.id,
      userId: event.userId,
      name: event.user
        ? [event.user.firstName, event.user.lastName].filter(Boolean).join(' ')
        : null,
      event: event.event,
      payload: event.payload,
      createdAt: event.createdAt.toISOString(),
    }));
  }

  @Post('memberships/:userId/approve')
  @Audited({ entityType: 'club_membership', action: 'approve', idFrom: { param: 'userId' } })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Повторить одобрение вручную' })
  async approve(@Param('userId') userId: string): Promise<void> {
    await this.club.manualApprove(userId);
  }

  @Post('memberships/:userId/remove')
  @Audited({ entityType: 'club_membership', action: 'remove', idFrom: { param: 'userId' } })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Исключить из клуба вручную' })
  async remove(
    @Param('userId') userId: string,
    @Body(zodBody(removeSchema)) body: { reason: string },
  ): Promise<void> {
    await this.club.manualRemove(userId, body.reason);
  }

  @Post('audit')
  @ApiOperation({ summary: 'Запустить сверку клуба сейчас' })
  async runAudit() {
    return this.club.audit();
  }
}
