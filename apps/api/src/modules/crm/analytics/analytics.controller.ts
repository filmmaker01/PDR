import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AllowExpiredAccess, Can, Workspace } from '@/modules/workspaces/guards/workspace.guard';
import { Ws } from '@/modules/workspaces/decorators/workspace.decorators';
import type { WorkspaceContext } from '@/modules/workspaces/workspace.types';
import { AnalyticsService } from './analytics.service';

const dayIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ожидается дата в формате 2026-05-01');

const periodQuerySchema = z.object({
  from: dayIso.optional(),
  to: dayIso.optional(),
  assigneeMemberId: z.string().uuid().optional(),
});

const seriesQuerySchema = periodQuerySchema.extend({
  granularity: z.enum(['day', 'week']).default('day'),
});

@ApiTags('crm')
@Controller('workspaces/:workspaceId/analytics')
@Workspace()
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('summary')
  @Can('analytics.read')
  @AllowExpiredAccess()
  @ApiOperation({ summary: 'Показатели мастерской за период' })
  async summary(@Ws() ws: WorkspaceContext, @Query() query: Record<string, string>) {
    return this.analytics.summary(ws, periodQuerySchema.parse(query));
  }

  @Get('series')
  @Can('analytics.read')
  @AllowExpiredAccess()
  @ApiOperation({ summary: 'Показатели по дням или неделям' })
  async series(@Ws() ws: WorkspaceContext, @Query() query: Record<string, string>) {
    return this.analytics.series(ws, seriesQuerySchema.parse(query));
  }

  @Get('employees')
  @Can('analytics.read')
  @AllowExpiredAccess()
  @ApiOperation({ summary: 'Показатели по исполнителям' })
  async employees(@Ws() ws: WorkspaceContext, @Query() query: Record<string, string>) {
    return this.analytics.employees(ws, periodQuerySchema.parse(query));
  }
}
