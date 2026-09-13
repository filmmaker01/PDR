import { Injectable } from '@nestjs/common';
import { Prisma, type Client, type Vehicle } from '@prisma/client';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { WorkspaceScopedRepository } from '@/modules/workspaces/repositories/workspace-scoped.repository';

export interface ClientListFilter {
  q?: string;
  archived?: boolean;
  limit: number;
  cursor?: string;
}

/**
 * Доступ к клиентам всегда ограничен мастерской.
 * Метода без workspaceId здесь нет и быть не должно.
 */
@Injectable()
export class ClientsRepository extends WorkspaceScopedRepository {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  async findById(workspaceId: string, clientId: string): Promise<Client | null> {
    return this.prisma.client.findFirst({ where: { id: clientId, workspaceId } });
  }

  async list(
    workspaceId: string,
    filter: ClientListFilter,
  ): Promise<{ items: (Client & { vehicles: Vehicle[] })[]; nextCursor: string | null }> {
    const term = filter.q?.trim();

    const where: Prisma.ClientWhereInput = {
      workspaceId,
      ...(filter.archived ? { archivedAt: { not: null } } : { archivedAt: null }),
      ...(term
        ? {
            OR: [
              { name: { contains: term, mode: 'insensitive' } },
              { phone: { contains: term.replace(/\D/g, '') } },
              { notes: { contains: term, mode: 'insensitive' } },
              { vehicles: { some: { plate: { contains: term.toUpperCase() } } } },
              { vehicles: { some: { model: { contains: term, mode: 'insensitive' } } } },
            ],
          }
        : {}),
    };

    return this.paginate(
      (take, cursor) =>
        this.prisma.client.findMany({
          where,
          include: { vehicles: { where: { archivedAt: null }, orderBy: { createdAt: 'asc' } } },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        }),
      filter.limit,
      filter.cursor,
    );
  }

  async create(workspaceId: string, data: Prisma.ClientUncheckedCreateInput): Promise<Client> {
    return this.prisma.client.create({ data: { ...data, workspaceId } });
  }

  async update(
    workspaceId: string,
    clientId: string,
    data: Prisma.ClientUncheckedUpdateInput,
  ): Promise<Client> {
    const client = await this.findById(workspaceId, clientId);
    this.assertOwned(client, workspaceId, 'Клиент не найден');
    // workspaceId никогда не переносится: клиент не может «переехать» в другую мастерскую.
    const { workspaceId: _ignored, id: _id, ...safe } = data;
    void _ignored;
    void _id;
    return this.prisma.client.update({ where: { id: clientId }, data: safe });
  }

  async countOrders(workspaceId: string, clientId: string): Promise<number> {
    return this.prisma.order.count({ where: { workspaceId, clientId } });
  }

  async debtMinor(workspaceId: string, clientId: string): Promise<bigint> {
    const orders = await this.prisma.order.findMany({
      where: { workspaceId, clientId, status: { not: 'cancelled' }, archivedAt: null },
      select: { agreedTotalMinor: true, paidMinor: true },
    });
    return orders.reduce((sum, order) => {
      const agreed = order.agreedTotalMinor ?? 0n;
      const debt = agreed - order.paidMinor;
      return debt > 0n ? sum + debt : sum;
    }, 0n);
  }
}
