import type { PrismaService } from '@/infra/prisma/prisma.service';
import { AppError } from '@/common/errors/app.error';

/**
 * База для репозиториев CRM.
 *
 * Единственный способ обратиться к данным мастерской — через наследника,
 * который обязан передавать workspaceId в каждый запрос. Прямое использование
 * Prisma-моделей CRM вне репозиториев запрещено правилом ESLint, а связи в базе
 * дополнительно защищены составными внешними ключами с workspace_id.
 */
export abstract class WorkspaceScopedRepository {
  constructor(protected readonly prisma: PrismaService) {}

  /** Проверка, что найденная запись принадлежит нужной мастерской. */
  protected assertOwned<T extends { workspaceId: string } | null>(
    entity: T,
    workspaceId: string,
    notFoundMessage: string,
  ): NonNullable<T> {
    if (!entity || entity.workspaceId !== workspaceId) {
      throw AppError.notFound(notFoundMessage);
    }
    return entity as NonNullable<T>;
  }

  /** Курсорная страница с устойчивым порядком. */
  protected async paginate<T extends { id: string }>(
    fetch: (take: number, cursor?: string) => Promise<T[]>,
    limit: number,
    cursor?: string,
  ): Promise<{ items: T[]; nextCursor: string | null }> {
    const rows = await fetch(limit + 1, cursor);
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    return { items, nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null };
  }
}
