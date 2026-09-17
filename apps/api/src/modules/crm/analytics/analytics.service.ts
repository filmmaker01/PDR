import { Injectable } from '@nestjs/common';
import { dayRangeInZone, todayInZone } from '@pdr/shared';
import { AppError } from '@/common/errors/app.error';
import { WorkspacesService } from '@/modules/workspaces/workspaces.service';
import type { WorkspaceContext } from '@/modules/workspaces/workspace.types';
import {
  AnalyticsRepository,
  type EmployeeRow,
  type SeriesPoint,
} from '../repositories/analytics.repository';

/** Больше года за один запрос не считаем: это отчёт, а не выгрузка. */
const MAX_PERIOD_DAYS = 366;

export interface PeriodInput {
  /** Дни в часовом поясе мастерской: `YYYY-MM-DD`. */
  from?: string;
  to?: string;
  assigneeMemberId?: string;
}

export interface AnalyticsSummary {
  from: string;
  to: string;
  currency: string;
  completedOrders: number;
  completedTotalMinor: number;
  receivedMinor: number;
  averageCheckMinor: number;
  newClients: number;
  appointmentMinutes: number;
}

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly analytics: AnalyticsRepository,
    private readonly workspaces: WorkspacesService,
  ) {}

  async summary(ctx: WorkspaceContext, input: PeriodInput): Promise<AnalyticsSummary> {
    const period = this.resolvePeriod(ctx, input);

    const [completed, received, newClients, minutes] = await Promise.all([
      this.analytics.completed(ctx.workspaceId, period.range),
      this.analytics.received(ctx.workspaceId, period.range),
      this.analytics.newClients(ctx.workspaceId, period.range),
      this.analytics.appointmentMinutes(ctx.workspaceId, period.range),
    ]);

    return {
      from: period.fromDay,
      to: period.toDay,
      currency: ctx.workspace.currency,
      completedOrders: completed.count,
      completedTotalMinor: completed.totalMinor,
      receivedMinor: received,
      // Средний чек по завершённым заказам: делить поступления на заказы нельзя,
      // они относятся к разным периодам.
      averageCheckMinor:
        completed.count > 0 ? Math.round(completed.totalMinor / completed.count) : 0,
      newClients,
      appointmentMinutes: minutes,
    };
  }

  async series(
    ctx: WorkspaceContext,
    input: PeriodInput & { granularity?: 'day' | 'week' },
  ): Promise<{ granularity: 'day' | 'week'; points: SeriesPoint[] }> {
    const period = this.resolvePeriod(ctx, input);
    const granularity = input.granularity ?? 'day';
    const points = await this.analytics.series(
      ctx.workspaceId,
      period.range,
      granularity,
      ctx.workspace.timezone,
    );
    return { granularity, points };
  }

  async employees(
    ctx: WorkspaceContext,
    input: PeriodInput,
  ): Promise<{
    rows: (EmployeeRow & { name: string; color: string | null; isActive: boolean })[];
  }> {
    const period = this.resolvePeriod(ctx, input);
    const [rows, members] = await Promise.all([
      this.analytics.byEmployee(ctx.workspaceId, period.range),
      this.membersOf(ctx),
    ]);

    const byId = new Map(members.map((member) => [member.id, member]));
    const named = rows
      .filter(
        (row) => row.completedOrders > 0 || row.receivedMinor !== 0 || row.appointmentMinutes > 0,
      )
      .map((row) => {
        const member = row.memberId ? byId.get(row.memberId) : undefined;
        return {
          ...row,
          name: member?.name ?? 'Без исполнителя',
          color: member?.color ?? null,
          isActive: member?.isActive ?? false,
        };
      })
      .sort((a, b) => b.completedTotalMinor - a.completedTotalMinor);

    return { rows: named };
  }

  private membersOf(
    ctx: WorkspaceContext,
  ): Promise<{ id: string; name: string; color: string | null; isActive: boolean }[]> {
    return this.workspaces.listMembers(ctx.workspaceId).then((members) =>
      members.map((member) => ({
        id: member.id,
        name:
          member.displayName ??
          [member.user.firstName, member.user.lastName].filter(Boolean).join(' '),
        color: member.color,
        isActive: member.isActive,
      })),
    );
  }

  /** Период задаётся днями в часовом поясе мастерской, по умолчанию — 30 дней. */
  private resolvePeriod(
    ctx: WorkspaceContext,
    input: PeriodInput,
  ): {
    range: { from: Date; to: Date; assigneeMemberId?: string };
    fromDay: string;
    toDay: string;
  } {
    const timezone = ctx.workspace.timezone;
    const today = todayInZone(timezone);
    const toDay = input.to ?? today;
    const fromDay =
      input.from ??
      new Date(new Date(`${toDay}T00:00:00Z`).getTime() - 29 * 86_400_000)
        .toISOString()
        .slice(0, 10);

    if (fromDay > toDay) throw AppError.validation('Начало периода позже конца');

    const start = dayRangeInZone(fromDay, timezone).from;
    const end = dayRangeInZone(toDay, timezone).to;
    if (end.getTime() - start.getTime() > MAX_PERIOD_DAYS * 86_400_000) {
      throw AppError.validation(`Период не может превышать ${MAX_PERIOD_DAYS} дней`);
    }

    return {
      range: { from: start, to: end, assigneeMemberId: input.assigneeMemberId },
      fromDay,
      toDay,
    };
  }
}
