import { Injectable } from '@nestjs/common';
import { Prisma, type Estimate } from '@prisma/client';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { WorkspaceScopedRepository } from '@/modules/workspaces/repositories/workspace-scoped.repository';

export type EstimateWithItems = Prisma.EstimateGetPayload<{
  include: {
    items: true;
    createdBy: { select: { firstName: true; lastName: true } };
    agreedBy: { select: { firstName: true; lastName: true } };
  };
}>;

const RELATIONS = {
  items: true,
  createdBy: { select: { firstName: true, lastName: true } },
  agreedBy: { select: { firstName: true, lastName: true } },
} satisfies Prisma.EstimateInclude;

@Injectable()
export class EstimatesRepository extends WorkspaceScopedRepository {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  async findById(
    workspaceId: string,
    estimateId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<EstimateWithItems | null> {
    const client = tx ?? this.prisma;
    return client.estimate.findFirst({
      where: { id: estimateId, workspaceId },
      include: { ...RELATIONS, items: { orderBy: { position: 'asc' } } },
    });
  }

  async listForOrder(workspaceId: string, orderId: string): Promise<EstimateWithItems[]> {
    return this.prisma.estimate.findMany({
      where: { workspaceId, orderId },
      include: { ...RELATIONS, items: { orderBy: { position: 'asc' } } },
      orderBy: { versionNo: 'desc' },
    });
  }

  async findDraftForOrder(
    workspaceId: string,
    orderId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<Estimate | null> {
    const client = tx ?? this.prisma;
    return client.estimate.findFirst({
      where: { workspaceId, orderId, status: 'draft' },
      orderBy: { versionNo: 'desc' },
    });
  }

  async findAgreedForOrder(
    workspaceId: string,
    orderId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<Estimate | null> {
    const client = tx ?? this.prisma;
    return client.estimate.findFirst({ where: { workspaceId, orderId, status: 'agreed' } });
  }

  async nextVersionNo(
    workspaceId: string,
    orderId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const client = tx ?? this.prisma;
    const last = await client.estimate.findFirst({
      where: { workspaceId, orderId },
      orderBy: { versionNo: 'desc' },
      select: { versionNo: true },
    });
    return (last?.versionNo ?? 0) + 1;
  }

  async create(
    workspaceId: string,
    data: Omit<Prisma.EstimateUncheckedCreateInput, 'workspaceId'>,
    tx?: Prisma.TransactionClient,
  ): Promise<Estimate> {
    const client = tx ?? this.prisma;
    return client.estimate.create({ data: { ...data, workspaceId } });
  }

  async update(
    workspaceId: string,
    estimateId: string,
    data: Prisma.EstimateUncheckedUpdateInput,
    tx?: Prisma.TransactionClient,
  ): Promise<Estimate> {
    const client = tx ?? this.prisma;
    const existing = await client.estimate.findFirst({
      where: { id: estimateId, workspaceId },
      select: { id: true },
    });
    if (!existing) {
      const { AppError } = await import('@/common/errors/app.error');
      throw AppError.notFound('Смета не найдена');
    }
    const { workspaceId: _ws, id: _id, ...safe } = data;
    void _ws;
    void _id;
    return client.estimate.update({ where: { id: estimateId }, data: safe });
  }

  /** Полная замена позиций: сметы редактируются целиком, а не по одной строке. */
  async replaceItems(
    workspaceId: string,
    estimateId: string,
    items: Omit<Prisma.EstimateItemUncheckedCreateInput, 'workspaceId' | 'estimateId'>[],
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    await tx.estimateItem.deleteMany({ where: { workspaceId, estimateId } });
    if (items.length === 0) return;
    await tx.estimateItem.createMany({
      data: items.map((item) => ({ ...item, workspaceId, estimateId })),
    });
  }

  async itemsOf(
    workspaceId: string,
    estimateId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<Prisma.EstimateItemGetPayload<object>[]> {
    const client = tx ?? this.prisma;
    return client.estimateItem.findMany({
      where: { workspaceId, estimateId },
      orderBy: { position: 'asc' },
    });
  }
}
