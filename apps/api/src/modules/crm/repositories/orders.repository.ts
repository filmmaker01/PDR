import { Injectable } from '@nestjs/common';
import { AppError } from '@/common/errors/app.error';
import { Prisma, type Order, type OrderStatus } from '@prisma/client';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { WorkspaceScopedRepository } from '@/modules/workspaces/repositories/workspace-scoped.repository';

export interface OrderListFilter {
  statuses?: OrderStatus[];
  assigneeMemberId?: string;
  paymentStatus?: string;
  q?: string;
  from?: Date;
  to?: Date;
  archived?: boolean;
  /** Ограничение для сотрудника без права видеть чужие заказы. */
  onlyForMember?: { memberId: string; userId: string };
  limit: number;
  cursor?: string;
}

export type OrderWithRelations = Prisma.OrderGetPayload<{
  include: {
    client: true;
    vehicle: true;
    assignee: { include: { user: { select: { firstName: true; lastName: true } } } };
  };
}>;

@Injectable()
export class OrdersRepository extends WorkspaceScopedRepository {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  async findById(workspaceId: string, orderId: string): Promise<OrderWithRelations | null> {
    return this.prisma.order.findFirst({
      where: { id: orderId, workspaceId },
      include: {
        client: true,
        vehicle: true,
        assignee: { include: { user: { select: { firstName: true, lastName: true } } } },
      },
    });
  }

  private buildWhere(workspaceId: string, filter: OrderListFilter): Prisma.OrderWhereInput {
    const term = filter.q?.trim();
    const asNumber = term && /^\d+$/.test(term) ? Number(term) : null;

    return {
      workspaceId,
      ...(filter.archived ? { archivedAt: { not: null } } : { archivedAt: null }),
      ...(filter.statuses?.length ? { status: { in: filter.statuses } } : {}),
      ...(filter.assigneeMemberId ? { assigneeMemberId: filter.assigneeMemberId } : {}),
      ...(filter.paymentStatus
        ? { paymentStatus: filter.paymentStatus as Prisma.EnumPaymentStatusFilter['equals'] }
        : {}),
      ...(filter.from || filter.to
        ? {
            createdAt: {
              ...(filter.from ? { gte: filter.from } : {}),
              ...(filter.to ? { lt: filter.to } : {}),
            },
          }
        : {}),
      ...(filter.onlyForMember
        ? {
            OR: [
              { assigneeMemberId: filter.onlyForMember.memberId },
              { createdById: filter.onlyForMember.userId },
            ],
          }
        : {}),
      ...(term
        ? {
            AND: [
              {
                OR: [
                  ...(asNumber !== null ? [{ number: asNumber }] : []),
                  { title: { contains: term, mode: 'insensitive' as const } },
                  { client: { name: { contains: term, mode: 'insensitive' as const } } },
                  { client: { phone: { contains: term.replace(/\D/g, '') } } },
                  { vehicle: { plate: { contains: term.toUpperCase() } } },
                  { vehicle: { model: { contains: term, mode: 'insensitive' as const } } },
                ],
              },
            ],
          }
        : {}),
    };
  }

  async list(
    workspaceId: string,
    filter: OrderListFilter,
  ): Promise<{ items: OrderWithRelations[]; nextCursor: string | null }> {
    const where = this.buildWhere(workspaceId, filter);
    return this.paginate(
      (take, cursor) =>
        this.prisma.order.findMany({
          where,
          include: {
            client: true,
            vehicle: true,
            assignee: { include: { user: { select: { firstName: true, lastName: true } } } },
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        }),
      filter.limit,
      filter.cursor,
    );
  }

  async count(
    workspaceId: string,
    filter: Omit<OrderListFilter, 'limit' | 'cursor'>,
  ): Promise<number> {
    return this.prisma.order.count({
      where: this.buildWhere(workspaceId, { ...filter, limit: 1 }),
    });
  }

  async create(
    workspaceId: string,
    data: Prisma.OrderUncheckedCreateInput,
    tx?: Prisma.TransactionClient,
  ): Promise<Order> {
    const client = tx ?? this.prisma;
    return client.order.create({ data: { ...data, workspaceId } });
  }

  async update(
    workspaceId: string,
    orderId: string,
    data: Prisma.OrderUncheckedUpdateInput,
    tx?: Prisma.TransactionClient,
  ): Promise<Order> {
    const client = tx ?? this.prisma;
    const existing = await client.order.findFirst({
      where: { id: orderId, workspaceId },
      select: { id: true },
    });
    if (!existing) {
      throw AppError.notFound('Заказ не найден');
    }
    const { workspaceId: _ignored, id: _id, ...safe } = data;
    void _ignored;
    void _id;
    return client.order.update({ where: { id: orderId }, data: safe });
  }

  async addHistory(
    workspaceId: string,
    input: {
      orderId: string;
      fromStatus: OrderStatus | null;
      toStatus: OrderStatus;
      changedById: string;
      comment?: string | null;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    await client.orderStatusHistory.create({
      data: {
        workspaceId,
        orderId: input.orderId,
        fromStatus: input.fromStatus,
        toStatus: input.toStatus,
        changedById: input.changedById,
        comment: input.comment ?? null,
      },
    });
  }

  async history(workspaceId: string, orderId: string) {
    return this.prisma.orderStatusHistory.findMany({
      where: { workspaceId, orderId },
      orderBy: { createdAt: 'desc' },
      include: { changedBy: { select: { firstName: true, lastName: true } } },
    });
  }

  async clientOrders(workspaceId: string, clientId: string) {
    return this.prisma.order.findMany({
      where: { workspaceId, clientId },
      orderBy: { createdAt: 'desc' },
      include: { vehicle: true },
      take: 50,
    });
  }
}
