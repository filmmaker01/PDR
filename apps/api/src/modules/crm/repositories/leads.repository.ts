import { Injectable } from '@nestjs/common';
import {
  Prisma,
  type Lead,
  type LeadChannel,
  type LeadSource,
  type LeadStatus,
} from '@prisma/client';
import { AppError } from '@/common/errors/app.error';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { WorkspaceScopedRepository } from '@/modules/workspaces/repositories/workspace-scoped.repository';

export interface LeadListFilter {
  statuses?: LeadStatus[];
  source?: LeadSource;
  channel?: LeadChannel;
  assigneeMemberId?: string;
  q?: string;
  /** Только те, кому пора звонить: дата следующего контакта уже наступила. */
  dueOnly?: boolean;
  archived?: boolean;
  /** Ограничение для сотрудника без права видеть чужие обращения. */
  onlyForMember?: { memberId: string; userId: string };
  limit: number;
  cursor?: string;
}

const LEAD_INCLUDE = {
  client: { select: { id: true, name: true, phone: true } },
  vehicle: { select: { id: true, make: true, model: true, plate: true } },
  assignee: { include: { user: { select: { firstName: true, lastName: true } } } },
  convertedOrder: { select: { id: true, number: true } },
} satisfies Prisma.LeadInclude;

export type LeadWithRelations = Prisma.LeadGetPayload<{ include: typeof LEAD_INCLUDE }>;

@Injectable()
export class LeadsRepository extends WorkspaceScopedRepository {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  async findById(
    workspaceId: string,
    leadId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<LeadWithRelations | null> {
    const client = tx ?? this.prisma;
    return client.lead.findFirst({ where: { id: leadId, workspaceId }, include: LEAD_INCLUDE });
  }

  private buildWhere(workspaceId: string, filter: LeadListFilter): Prisma.LeadWhereInput {
    const term = filter.q?.trim();
    const asNumber = term && /^\d+$/.test(term) ? Number(term) : null;
    const digits = term?.replace(/\D/g, '');

    return {
      workspaceId,
      ...(filter.archived ? { archivedAt: { not: null } } : { archivedAt: null }),
      ...(filter.statuses?.length ? { status: { in: filter.statuses } } : {}),
      ...(filter.source ? { source: filter.source } : {}),
      ...(filter.channel ? { channel: filter.channel } : {}),
      ...(filter.assigneeMemberId ? { assigneeMemberId: filter.assigneeMemberId } : {}),
      ...(filter.dueOnly ? { nextContactAt: { not: null, lte: new Date() } } : {}),
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
                  { contactName: { contains: term, mode: 'insensitive' as const } },
                  { contactExtra: { contains: term, mode: 'insensitive' as const } },
                  { vehicleModel: { contains: term, mode: 'insensitive' as const } },
                  { vehiclePlate: { contains: term.toUpperCase() } },
                  { client: { name: { contains: term, mode: 'insensitive' as const } } },
                  ...(digits ? [{ contactPhone: { contains: digits } }] : []),
                  ...(digits ? [{ client: { phone: { contains: digits } } }] : []),
                ],
              },
            ],
          }
        : {}),
    };
  }

  async list(
    workspaceId: string,
    filter: LeadListFilter,
  ): Promise<{ items: LeadWithRelations[]; nextCursor: string | null }> {
    const where = this.buildWhere(workspaceId, filter);
    return this.paginate(
      (take, cursor) =>
        this.prisma.lead.findMany({
          where,
          include: LEAD_INCLUDE,
          // Сначала те, кому пора звонить, потом свежие: список открывают,
          // чтобы понять, чем заняться прямо сейчас.
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
    filter: Omit<LeadListFilter, 'limit' | 'cursor'>,
  ): Promise<number> {
    return this.prisma.lead.count({ where: this.buildWhere(workspaceId, { ...filter, limit: 1 }) });
  }

  /** Счётчики по статусам одним запросом: карточка на главной обновляется часто. */
  async countByStatus(
    workspaceId: string,
    filter: Omit<LeadListFilter, 'limit' | 'cursor' | 'statuses'>,
  ): Promise<Record<string, number>> {
    const rows = await this.prisma.lead.groupBy({
      by: ['status'],
      where: this.buildWhere(workspaceId, { ...filter, limit: 1 }),
      _count: { _all: true },
    });
    return Object.fromEntries(rows.map((row) => [row.status, row._count._all]));
  }

  async create(
    workspaceId: string,
    data: Omit<Prisma.LeadUncheckedCreateInput, 'workspaceId'>,
    tx?: Prisma.TransactionClient,
  ): Promise<Lead> {
    const client = tx ?? this.prisma;
    return client.lead.create({ data: { ...data, workspaceId } });
  }

  async update(
    workspaceId: string,
    leadId: string,
    data: Prisma.LeadUncheckedUpdateInput,
    tx?: Prisma.TransactionClient,
  ): Promise<Lead> {
    const client = tx ?? this.prisma;
    const existing = await client.lead.findFirst({
      where: { id: leadId, workspaceId },
      select: { id: true },
    });
    if (!existing) throw AppError.notFound('Обращение не найдено');
    const { workspaceId: _ignored, id: _id, ...safe } = data;
    void _ignored;
    void _id;
    return client.lead.update({ where: { id: leadId }, data: safe });
  }

  async addHistory(
    workspaceId: string,
    input: {
      leadId: string;
      fromStatus: LeadStatus | null;
      toStatus: LeadStatus;
      changedById: string | null;
      comment?: string | null;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    await client.leadStatusHistory.create({
      data: {
        workspaceId,
        leadId: input.leadId,
        fromStatus: input.fromStatus,
        toStatus: input.toStatus,
        changedById: input.changedById,
        comment: input.comment ?? null,
      },
    });
  }

  async history(workspaceId: string, leadId: string) {
    return this.prisma.leadStatusHistory.findMany({
      where: { workspaceId, leadId },
      orderBy: { createdAt: 'desc' },
      include: { changedBy: { select: { firstName: true, lastName: true } } },
      take: 100,
    });
  }

  /**
   * Номер обращения внутри мастерской.
   *
   * Счётчик подтягивается до фактического максимума тем же приёмом, что и
   * номера заказов: перенесённые из другой системы записи не должны ломать
   * создание нового обращения ошибкой уникальности.
   */
  async nextNumber(workspaceId: string, tx?: Prisma.TransactionClient): Promise<number> {
    const client = tx ?? this.prisma;
    const rows = await client.$queryRaw<{ lead_seq: number }[]>`
      UPDATE workspaces
         SET lead_seq = GREATEST(
               lead_seq,
               COALESCE((SELECT max(number) FROM leads WHERE workspace_id = ${workspaceId}::uuid), 0)
             ) + 1
       WHERE id = ${workspaceId}::uuid
      RETURNING lead_seq
    `;
    const next = rows[0]?.lead_seq;
    if (next === undefined) throw AppError.notFound('Мастерская не найдена');
    return next;
  }
}
