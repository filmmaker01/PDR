import { Injectable } from '@nestjs/common';
import { AppError } from '@/common/errors/app.error';
import { Prisma, type EstimateItemKind, type PriceListItem } from '@prisma/client';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { WorkspaceScopedRepository } from '@/modules/workspaces/repositories/workspace-scoped.repository';

@Injectable()
export class PriceListRepository extends WorkspaceScopedRepository {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  async list(
    workspaceId: string,
    includeInactive = false,
    kind?: EstimateItemKind,
  ): Promise<PriceListItem[]> {
    return this.prisma.priceListItem.findMany({
      where: {
        workspaceId,
        ...(includeInactive ? {} : { isActive: true }),
        ...(kind ? { kind } : {}),
      },
      orderBy: [{ position: 'asc' }, { title: 'asc' }],
    });
  }

  async findById(
    workspaceId: string,
    itemId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<PriceListItem | null> {
    const client = tx ?? this.prisma;
    return client.priceListItem.findFirst({ where: { id: itemId, workspaceId } });
  }

  async findManyByIds(workspaceId: string, ids: string[]): Promise<PriceListItem[]> {
    if (ids.length === 0) return [];
    return this.prisma.priceListItem.findMany({ where: { workspaceId, id: { in: ids } } });
  }

  async nextPosition(workspaceId: string): Promise<number> {
    const last = await this.prisma.priceListItem.findFirst({
      where: { workspaceId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    return (last?.position ?? 0) + 1;
  }

  async create(
    workspaceId: string,
    data: Omit<Prisma.PriceListItemUncheckedCreateInput, 'workspaceId'>,
  ): Promise<PriceListItem> {
    return this.prisma.priceListItem.create({ data: { ...data, workspaceId } });
  }

  async update(
    workspaceId: string,
    itemId: string,
    data: Prisma.PriceListItemUncheckedUpdateInput,
  ): Promise<PriceListItem> {
    const existing = await this.findById(workspaceId, itemId);
    if (!existing) {
      throw AppError.notFound('Позиция прайса не найдена');
    }
    const { workspaceId: _ws, id: _id, ...safe } = data;
    void _ws;
    void _id;
    return this.prisma.priceListItem.update({ where: { id: itemId }, data: safe });
  }

  async delete(workspaceId: string, itemId: string): Promise<void> {
    await this.prisma.priceListItem.deleteMany({ where: { id: itemId, workspaceId } });
  }

  /**
   * Сколько раз позиция прайса использована — в сметах и в оценках.
   *
   * Оценки считаются наравне со сметами: арматурная работа попадает сначала
   * в оценку, и удаление позиции оборвало бы ссылку в уже посчитанной сумме.
   */
  async usageCount(workspaceId: string, itemId: string): Promise<number> {
    const [inEstimates, inAssessments] = await Promise.all([
      this.prisma.estimateItem.count({ where: { workspaceId, priceListItemId: itemId } }),
      this.prisma.assessmentItem.count({ where: { workspaceId, priceListItemId: itemId } }),
    ]);
    return inEstimates + inAssessments;
  }

  async reorder(workspaceId: string, orderedIds: string[]): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // Два прохода: позиции уникальны в пределах мастерской только логически,
      // но временный отрицательный диапазон защищает от коллизий при перестановке.
      for (const [index, id] of orderedIds.entries()) {
        await tx.priceListItem.updateMany({
          where: { id, workspaceId },
          data: { position: -(index + 1) },
        });
      }
      for (const [index, id] of orderedIds.entries()) {
        await tx.priceListItem.updateMany({
          where: { id, workspaceId },
          data: { position: index + 1 },
        });
      }
    });
  }
}
