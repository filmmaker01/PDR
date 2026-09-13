import { Injectable } from '@nestjs/common';
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

@Injectable()
export class OrderPhotosRepository extends WorkspaceScopedRepository {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  async listForOrder(workspaceId: string, orderId: string): Promise<OrderPhotoWithFile[]> {
    return this.prisma.orderPhoto.findMany({
      where: { workspaceId, orderId },
      include: RELATIONS,
      orderBy: [{ category: 'asc' }, { position: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async findById(workspaceId: string, photoId: string): Promise<OrderPhotoWithFile | null> {
    return this.prisma.orderPhoto.findFirst({
      where: { id: photoId, workspaceId },
      include: RELATIONS,
    });
  }

  async findByFile(
    workspaceId: string,
    orderId: string,
    fileId: string,
  ): Promise<OrderPhotoWithFile | null> {
    return this.prisma.orderPhoto.findFirst({
      where: { workspaceId, orderId, fileId },
      include: RELATIONS,
    });
  }

  async nextPosition(workspaceId: string, orderId: string, category: string): Promise<number> {
    const last = await this.prisma.orderPhoto.findFirst({
      where: {
        workspaceId,
        orderId,
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
      const { AppError } = await import('@/common/errors/app.error');
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

  async countForOrder(workspaceId: string, orderId: string): Promise<number> {
    return this.prisma.orderPhoto.count({ where: { workspaceId, orderId } });
  }
}
