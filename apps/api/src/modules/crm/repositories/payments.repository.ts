import { Injectable } from '@nestjs/common';
import { Prisma, type PaymentEntry } from '@prisma/client';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { WorkspaceScopedRepository } from '@/modules/workspaces/repositories/workspace-scoped.repository';

export type PaymentWithAuthor = Prisma.PaymentEntryGetPayload<{
  include: { createdBy: { select: { firstName: true; lastName: true } } };
}>;

export interface PaymentJournalFilter {
  from?: Date;
  to?: Date;
  method?: string;
  createdById?: string;
  orderId?: string;
  limit: number;
  cursor?: string;
}

@Injectable()
export class PaymentsRepository extends WorkspaceScopedRepository {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  async listForOrder(
    workspaceId: string,
    orderId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<PaymentWithAuthor[]> {
    const client = tx ?? this.prisma;
    return client.paymentEntry.findMany({
      where: { workspaceId, orderId },
      include: { createdBy: { select: { firstName: true, lastName: true } } },
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async findById(
    workspaceId: string,
    entryId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<PaymentEntry | null> {
    const client = tx ?? this.prisma;
    return client.paymentEntry.findFirst({ where: { id: entryId, workspaceId } });
  }

  async create(
    workspaceId: string,
    data: Omit<Prisma.PaymentEntryUncheckedCreateInput, 'workspaceId'>,
    tx?: Prisma.TransactionClient,
  ): Promise<PaymentEntry> {
    const client = tx ?? this.prisma;
    return client.paymentEntry.create({ data: { ...data, workspaceId } });
  }

  /** Суммы по видам записей: основа пересчёта оплаченного по заказу. */
  async totalsByKind(
    workspaceId: string,
    orderId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<Record<string, bigint>> {
    const client = tx ?? this.prisma;
    const rows = await client.paymentEntry.groupBy({
      by: ['kind'],
      where: { workspaceId, orderId },
      _sum: { amountMinor: true },
    });
    const totals: Record<string, bigint> = {};
    for (const row of rows) totals[row.kind] = row._sum.amountMinor ?? BigInt(0);
    return totals;
  }

  async journal(
    workspaceId: string,
    filter: PaymentJournalFilter,
  ): Promise<{
    items: (PaymentWithAuthor & {
      order: { id: string; number: number; client: { name: string } };
    })[];
    nextCursor: string | null;
  }> {
    const where: Prisma.PaymentEntryWhereInput = {
      workspaceId,
      ...(filter.orderId ? { orderId: filter.orderId } : {}),
      ...(filter.method
        ? { method: filter.method as Prisma.EnumPaymentMethodFilter['equals'] }
        : {}),
      ...(filter.createdById ? { createdById: filter.createdById } : {}),
      ...(filter.from || filter.to
        ? {
            occurredAt: {
              ...(filter.from ? { gte: filter.from } : {}),
              ...(filter.to ? { lt: filter.to } : {}),
            },
          }
        : {}),
    };

    return this.paginate(
      (take, cursor) =>
        this.prisma.paymentEntry.findMany({
          where,
          include: {
            createdBy: { select: { firstName: true, lastName: true } },
            order: { select: { id: true, number: true, client: { select: { name: true } } } },
          },
          orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
          take,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        }),
      filter.limit,
      filter.cursor,
    );
  }

  /** Итоги за период для журнала и аналитики. */
  async periodTotals(
    workspaceId: string,
    range: { from: Date; to: Date },
  ): Promise<{ kind: string; method: string; totalMinor: number }[]> {
    const rows = await this.prisma.paymentEntry.groupBy({
      by: ['kind', 'method'],
      where: { workspaceId, occurredAt: { gte: range.from, lt: range.to } },
      _sum: { amountMinor: true },
    });
    return rows.map((row) => ({
      kind: row.kind,
      method: row.method,
      totalMinor: Number(row._sum.amountMinor ?? BigInt(0)),
    }));
  }
}
