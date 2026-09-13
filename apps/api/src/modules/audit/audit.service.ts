import { Injectable, Logger } from '@nestjs/common';
import type { AuditLog, Prisma } from '@prisma/client';
import { PrismaService } from '@/infra/prisma/prisma.service';

export interface AuditRecord {
  requestId?: string | null;
  actorUserId?: string | null;
  actorRoleContext?: string | null;
  workspaceId?: string | null;
  entityType: string;
  entityId?: string | null;
  action: string;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  userAgent?: string | null;
  tx?: Prisma.TransactionClient;
}

/** Поля, которые не должны попадать в журнал даже в снимках «до/после». */
const SENSITIVE_KEYS = new Set([
  'refreshTokenHash',
  'tokenHash',
  'accessToken',
  'refreshToken',
  'initData',
  'hash',
  'password',
  'secret',
]);

function sanitize(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (depth > 6) return '[глубоко вложено]';
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.slice(0, 100).map((v) => sanitize(v, depth + 1));
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      result[key] = SENSITIVE_KEYS.has(key) ? '[скрыто]' : sanitize(nested, depth + 1);
    }
    return result;
  }
  return value;
}

/** Разница между снимками: журнал хранит только изменившиеся поля. */
export function diff(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): { before: Record<string, unknown>; after: Record<string, unknown> } {
  if (!before) return { before: {}, after: sanitize(after ?? {}) as Record<string, unknown> };
  if (!after) return { before: sanitize(before) as Record<string, unknown>, after: {} };

  const changedBefore: Record<string, unknown> = {};
  const changedAfter: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);

  for (const key of keys) {
    const a = before[key];
    const b = after[key];
    if (JSON.stringify(sanitize(a)) !== JSON.stringify(sanitize(b))) {
      changedBefore[key] = sanitize(a);
      changedAfter[key] = sanitize(b);
    }
  }
  return { before: changedBefore, after: changedAfter };
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Запись в журнал. Ошибка журналирования не должна ронять операцию:
   * она логируется, но не пробрасывается.
   */
  async record(entry: AuditRecord): Promise<void> {
    const client = entry.tx ?? this.prisma;
    try {
      await client.auditLog.create({
        data: {
          requestId: entry.requestId ?? null,
          actorUserId: entry.actorUserId ?? null,
          actorRoleContext: entry.actorRoleContext ?? null,
          workspaceId: entry.workspaceId ?? null,
          entityType: entry.entityType,
          entityId: entry.entityId ?? null,
          action: entry.action,
          before:
            entry.before === undefined
              ? undefined
              : (sanitize(entry.before) as Prisma.InputJsonValue),
          after:
            entry.after === undefined
              ? undefined
              : (sanitize(entry.after) as Prisma.InputJsonValue),
          ip: entry.ip ?? null,
          userAgent: entry.userAgent?.slice(0, 300) ?? null,
        },
      });
    } catch (err) {
      this.logger.error(
        { err, entry: { ...entry, before: undefined, after: undefined } },
        'Не удалось записать в журнал',
      );
    }
  }

  async listWorkspace(
    workspaceId: string,
    filter: {
      entityType?: string;
      entityId?: string;
      from?: Date;
      to?: Date;
      limit: number;
      cursor?: string;
    },
  ): Promise<{ items: AuditLog[]; nextCursor: string | null }> {
    const items = await this.prisma.auditLog.findMany({
      where: {
        workspaceId,
        ...(filter.entityType ? { entityType: filter.entityType } : {}),
        ...(filter.entityId ? { entityId: filter.entityId } : {}),
        ...(filter.from || filter.to
          ? {
              createdAt: {
                ...(filter.from ? { gte: filter.from } : {}),
                ...(filter.to ? { lt: filter.to } : {}),
              },
            }
          : {}),
      },
      orderBy: { id: 'desc' },
      take: filter.limit + 1,
      ...(filter.cursor ? { cursor: { id: BigInt(filter.cursor) }, skip: 1 } : {}),
    });
    const hasMore = items.length > filter.limit;
    const page = hasMore ? items.slice(0, filter.limit) : items;
    return { items: page, nextCursor: hasMore ? (page.at(-1)?.id.toString() ?? null) : null };
  }

  /**
   * Платформенный журнал для администратора.
   * Записи мастерских отдаются без снимков «до/после»: администратор видит
   * факт действия, но не содержимое клиентской базы мастера.
   */
  async listPlatform(filter: {
    actorUserId?: string;
    entityType?: string;
    entityId?: string;
    action?: string;
    from?: Date;
    to?: Date;
    limit: number;
    cursor?: string;
  }): Promise<{
    items: (Omit<AuditLog, 'before' | 'after'> & { before: unknown; after: unknown })[];
    nextCursor: string | null;
  }> {
    const rows = await this.prisma.auditLog.findMany({
      where: {
        ...(filter.actorUserId ? { actorUserId: filter.actorUserId } : {}),
        ...(filter.entityType ? { entityType: filter.entityType } : {}),
        ...(filter.entityId ? { entityId: filter.entityId } : {}),
        ...(filter.action ? { action: filter.action } : {}),
        ...(filter.from || filter.to
          ? {
              createdAt: {
                ...(filter.from ? { gte: filter.from } : {}),
                ...(filter.to ? { lt: filter.to } : {}),
              },
            }
          : {}),
      },
      orderBy: { id: 'desc' },
      take: filter.limit + 1,
      ...(filter.cursor ? { cursor: { id: BigInt(filter.cursor) }, skip: 1 } : {}),
    });

    const hasMore = rows.length > filter.limit;
    const page = hasMore ? rows.slice(0, filter.limit) : rows;

    return {
      items: page.map((row) =>
        row.workspaceId
          ? { ...row, before: null, after: { маскировано: 'данные мастерской скрыты' } }
          : row,
      ),
      nextCursor: hasMore ? (page.at(-1)?.id.toString() ?? null) : null,
    };
  }
}
