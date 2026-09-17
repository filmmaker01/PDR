import { Injectable } from '@nestjs/common';
import { AppError } from '@/common/errors/app.error';
import { Prisma, type OrderPhoto } from '@prisma/client';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { WorkspaceScopedRepository } from '@/modules/workspaces/repositories/workspace-scoped.repository';

export type OrderPhotoWithFile = Prisma.OrderPhotoGetPayload<{
  include: {
    file: { select: { id: true; status: true; mimeType: true; width: true; height: true } };
  };
}>;

const RELATIONS = {
  file: { select: { id: true, status: true, mimeType: true, width: true, height: true } },
} satisfies Prisma.OrderPhotoInclude;

/** Снимок принадлежит либо заказу, либо обращению — так же, как в базе. */
export type PhotoParent = { leadId: string } | { orderId: string };

function whereParent(parent: PhotoParent): Prisma.OrderPhotoWhereInput {
  return 'leadId' in parent ? { leadId: parent.leadId } : { orderId: parent.orderId };
}

@Injectable()
export class OrderPhotosRepository extends WorkspaceScopedRepository {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  async listFor(workspaceId: string, parent: PhotoParent): Promise<OrderPhotoWithFile[]> {
    return this.prisma.orderPhoto.findMany({
      where: { workspaceId, ...whereParent(parent) },
      include: RELATIONS,
      orderBy: [{ category: 'asc' }, { position: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async listForOrder(workspaceId: string, orderId: string): Promise<OrderPhotoWithFile[]> {
    return this.listFor(workspaceId, { orderId });
  }

  async findById(workspaceId: string, photoId: string): Promise<OrderPhotoWithFile | null> {
    return this.prisma.orderPhoto.findFirst({
      where: { id: photoId, workspaceId },
      include: RELATIONS,
    });
  }

  async findByFile(
    workspaceId: string,
    parent: PhotoParent,
    fileId: string,
  ): Promise<OrderPhotoWithFile | null> {
    return this.prisma.orderPhoto.findFirst({
      where: { workspaceId, ...whereParent(parent), fileId },
      include: RELATIONS,
    });
  }

  async nextPosition(workspaceId: string, parent: PhotoParent, category: string): Promise<number> {
    const last = await this.prisma.orderPhoto.findFirst({
      where: {
        workspaceId,
        ...whereParent(parent),
        category: category as Prisma.EnumPhotoCategoryFilter['equals'],
      },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    return (last?.position ?? 0) + 1;
  }

  async create(
    workspaceId: string,
    data: Omit<Prisma.OrderPhotoUncheckedCreateInput, 'workspaceId'>,
  ): Promise<OrderPhoto> {
    return this.prisma.orderPhoto.create({ data: { ...data, workspaceId } });
  }

  async update(
    workspaceId: string,
    photoId: string,
    data: Prisma.OrderPhotoUncheckedUpdateInput,
  ): Promise<OrderPhoto> {
    const existing = await this.prisma.orderPhoto.findFirst({
      where: { id: photoId, workspaceId },
      select: { id: true },
    });
    if (!existing) {
      throw AppError.notFound('Фотография не найдена');
    }
    const { workspaceId: _ws, id: _id, ...safe } = data;
    void _ws;
    void _id;
    return this.prisma.orderPhoto.update({ where: { id: photoId }, data: safe });
  }

  async delete(workspaceId: string, photoId: string): Promise<void> {
    await this.prisma.orderPhoto.deleteMany({ where: { id: photoId, workspaceId } });
  }

  async countFor(workspaceId: string, parent: PhotoParent): Promise<number> {
    return this.prisma.orderPhoto.count({ where: { workspaceId, ...whereParent(parent) } });
  }

  async countForOrder(workspaceId: string, orderId: string): Promise<number> {
    return this.countFor(workspaceId, { orderId });
  }

  async countByDamage(workspaceId: string, damageIds: readonly string[]) {
    if (damageIds.length === 0) return new Map<string, number>();
    const rows = await this.prisma.orderPhoto.groupBy({
      by: ['damageId'],
      where: { workspaceId, damageId: { in: [...damageIds] } },
      _count: { _all: true },
    });
    return new Map(rows.filter((r) => r.damageId).map((r) => [r.damageId!, r._count._all]));
  }

  /**
   * Перенос снимков обращения в заказ при конверсии.
   * Файлы не перезагружаются: у снимка просто меняется владелец.
   */
  async moveToOrder(
    workspaceId: string,
    leadId: string,
    orderId: string,
    tx: Prisma.TransactionClient,
  ): Promise<number> {
    const result = await tx.orderPhoto.updateMany({
      where: { workspaceId, leadId },
      data: { leadId: null, orderId },
    });
    return result.count;
  }
}
