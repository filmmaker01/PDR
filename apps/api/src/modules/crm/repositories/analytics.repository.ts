import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { WorkspaceScopedRepository } from '@/modules/workspaces/repositories/workspace-scoped.repository';

export interface AnalyticsPeriod {
  from: Date;
  to: Date;
  assigneeMemberId?: string;
}

export interface SeriesPoint {
  bucket: string;
  completedOrders: number;
  completedTotalMinor: number;
  receivedMinor: number;
}

export interface EmployeeRow {
  memberId: string | null;
  completedOrders: number;
  completedTotalMinor: number;
  receivedMinor: number;
  appointmentMinutes: number;
}

/**
 * Аналитика читает агрегаты напрямую в SQL: перебор заказов в приложении
 * на нескольких тысячах записей уже заметен, а показатели простые.
 * Каждый запрос обязательно фильтруется по workspace_id.
 */
@Injectable()
export class AnalyticsRepository extends WorkspaceScopedRepository {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  private assignee(period: AnalyticsPeriod, column: Prisma.Sql): Prisma.Sql {
    return period.assigneeMemberId
      ? Prisma.sql`AND ${column} = ${period.assigneeMemberId}::uuid`
      : Prisma.empty;
  }

  /** Завершённые заказы и их согласованная стоимость. */
  async completed(
    workspaceId: string,
    period: AnalyticsPeriod,
  ): Promise<{ count: number; totalMinor: number }> {
    const rows = await this.prisma.$queryRaw<{ count: bigint; total: bigint | null }[]>(Prisma.sql`
      SELECT count(*)::bigint AS count, sum(coalesce(agreed_total_minor, 0))::bigint AS total
      FROM orders
      WHERE workspace_id = ${workspaceId}::uuid
        AND delivered_at >= ${period.from} AND delivered_at < ${period.to}
        AND status <> 'cancelled'
        ${this.assignee(period, Prisma.sql`assignee_member_id`)}
    `);
    const row = rows[0];
    return { count: Number(row?.count ?? 0), totalMinor: Number(row?.total ?? 0) };
  }

  /** Поступления за период: оплаты минус возвраты и корректировки. */
  async received(workspaceId: string, period: AnalyticsPeriod): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ received: bigint | null }[]>(Prisma.sql`
      SELECT sum(
               CASE WHEN p.kind = 'payment' THEN p.amount_minor ELSE -p.amount_minor END
             )::bigint AS received
      FROM payment_entries p
      JOIN orders o ON o.id = p.order_id AND o.workspace_id = p.workspace_id
      WHERE p.workspace_id = ${workspaceId}::uuid
        AND p.occurred_at >= ${period.from} AND p.occurred_at < ${period.to}
        ${this.assignee(period, Prisma.sql`o.assignee_member_id`)}
    `);
    return Number(rows[0]?.received ?? 0);
  }

  /** Текущая задолженность по выданным заказам. */
  async outstandingDebt(workspaceId: string, period: AnalyticsPeriod): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ debt: bigint | null }[]>(Prisma.sql`
      SELECT sum(coalesce(agreed_total_minor, 0) - paid_minor)::bigint AS debt
      FROM orders
      WHERE workspace_id = ${workspaceId}::uuid
        AND status = 'delivered'
        AND coalesce(agreed_total_minor, 0) > paid_minor
        ${this.assignee(period, Prisma.sql`assignee_member_id`)}
    `);
    return Number(rows[0]?.debt ?? 0);
  }

  async newClients(workspaceId: string, period: AnalyticsPeriod): Promise<number> {
    return this.prisma.client.count({
      where: { workspaceId, createdAt: { gte: period.from, lt: period.to } },
    });
  }

  /** Загрузка календаря: сумма длительностей состоявшихся и подтверждённых записей. */
  async appointmentMinutes(workspaceId: string, period: AnalyticsPeriod): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ minutes: number | null }[]>(Prisma.sql`
      SELECT coalesce(sum(extract(epoch FROM (ends_at - starts_at)) / 60), 0)::float AS minutes
      FROM appointments
      WHERE workspace_id = ${workspaceId}::uuid
        AND starts_at >= ${period.from} AND starts_at < ${period.to}
        AND status IN ('confirmed', 'done')
        ${this.assignee(period, Prisma.sql`assignee_member_id`)}
    `);
    return Math.round(rows[0]?.minutes ?? 0);
  }

  /**
   * Ряды по дням или неделям. Границы считаются в часовом поясе мастерской,
   * иначе «день» у мастера и в отчёте разошлись бы.
   */
  async series(
    workspaceId: string,
    period: AnalyticsPeriod,
    granularity: 'day' | 'week',
    timezone: string,
  ): Promise<SeriesPoint[]> {
    const unit = granularity === 'week' ? Prisma.sql`'week'` : Prisma.sql`'day'`;

    const rows = await this.prisma.$queryRaw<
      { bucket: Date; completed: bigint; total: bigint | null; received: bigint | null }[]
    >(Prisma.sql`
      WITH completed AS (
        SELECT date_trunc(${unit}, delivered_at AT TIME ZONE ${timezone}) AS bucket,
               count(*)::bigint AS completed,
               sum(coalesce(agreed_total_minor, 0))::bigint AS total
        FROM orders
        WHERE workspace_id = ${workspaceId}::uuid
          AND delivered_at >= ${period.from} AND delivered_at < ${period.to}
          AND status <> 'cancelled'
          ${this.assignee(period, Prisma.sql`assignee_member_id`)}
        GROUP BY 1
      ),
      money AS (
        SELECT date_trunc(${unit}, p.occurred_at AT TIME ZONE ${timezone}) AS bucket,
               sum(CASE WHEN p.kind = 'payment' THEN p.amount_minor ELSE -p.amount_minor END)::bigint AS received
        FROM payment_entries p
        JOIN orders o ON o.id = p.order_id AND o.workspace_id = p.workspace_id
        WHERE p.workspace_id = ${workspaceId}::uuid
          AND p.occurred_at >= ${period.from} AND p.occurred_at < ${period.to}
          ${this.assignee(period, Prisma.sql`o.assignee_member_id`)}
        GROUP BY 1
      )
      SELECT coalesce(c.bucket, m.bucket) AS bucket,
             coalesce(c.completed, 0)::bigint AS completed,
             coalesce(c.total, 0)::bigint AS total,
             coalesce(m.received, 0)::bigint AS received
      FROM completed c
      FULL OUTER JOIN money m ON m.bucket = c.bucket
      ORDER BY 1
    `);

    return rows.map((row) => ({
      bucket: row.bucket.toISOString().slice(0, 10),
      completedOrders: Number(row.completed),
      completedTotalMinor: Number(row.total ?? 0),
      receivedMinor: Number(row.received ?? 0),
    }));
  }

  /**
   * Показатели по исполнителям. Три простых запроса вместо одного с FULL JOIN:
   * Postgres не умеет полное соединение по `IS NOT DISTINCT FROM`, а сведение
   * трёх небольших наборов в памяти дешевле любой хитрой склейки в SQL.
   */
  async byEmployee(workspaceId: string, period: AnalyticsPeriod): Promise<EmployeeRow[]> {
    const [completed, money, load] = await Promise.all([
      this.prisma.$queryRaw<
        { member_id: string | null; completed: bigint; total: bigint | null }[]
      >(
        Prisma.sql`
          SELECT assignee_member_id AS member_id,
                 count(*)::bigint AS completed,
                 sum(coalesce(agreed_total_minor, 0))::bigint AS total
          FROM orders
          WHERE workspace_id = ${workspaceId}::uuid
            AND delivered_at >= ${period.from} AND delivered_at < ${period.to}
            AND status <> 'cancelled'
          GROUP BY 1
        `,
      ),
      this.prisma.$queryRaw<{ member_id: string | null; received: bigint | null }[]>(Prisma.sql`
        SELECT o.assignee_member_id AS member_id,
               sum(CASE WHEN p.kind = 'payment' THEN p.amount_minor ELSE -p.amount_minor END)::bigint AS received
        FROM payment_entries p
        JOIN orders o ON o.id = p.order_id AND o.workspace_id = p.workspace_id
        WHERE p.workspace_id = ${workspaceId}::uuid
          AND p.occurred_at >= ${period.from} AND p.occurred_at < ${period.to}
        GROUP BY 1
      `),
      this.prisma.$queryRaw<{ member_id: string | null; minutes: number | null }[]>(Prisma.sql`
        SELECT assignee_member_id AS member_id,
               coalesce(sum(extract(epoch FROM (ends_at - starts_at)) / 60), 0)::float AS minutes
        FROM appointments
        WHERE workspace_id = ${workspaceId}::uuid
          AND starts_at >= ${period.from} AND starts_at < ${period.to}
          AND status IN ('confirmed', 'done')
        GROUP BY 1
      `),
    ]);

    const rows = new Map<string, EmployeeRow>();
    const keyOf = (memberId: string | null): string => memberId ?? 'none';
    const ensure = (memberId: string | null): EmployeeRow => {
      const key = keyOf(memberId);
      let row = rows.get(key);
      if (!row) {
        row = {
          memberId,
          completedOrders: 0,
          completedTotalMinor: 0,
          receivedMinor: 0,
          appointmentMinutes: 0,
        };
        rows.set(key, row);
      }
      return row;
    };

    for (const item of completed) {
      const row = ensure(item.member_id);
      row.completedOrders = Number(item.completed);
      row.completedTotalMinor = Number(item.total ?? 0);
    }
    for (const item of money) ensure(item.member_id).receivedMinor = Number(item.received ?? 0);
    for (const item of load) {
      ensure(item.member_id).appointmentMinutes = Math.round(item.minutes ?? 0);
    }

    return [...rows.values()];
  }
}
