import { Injectable } from '@nestjs/common';
import { AppError } from '@/common/errors/app.error';
import { Prisma, type Appointment, type AppointmentStatus } from '@prisma/client';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { WorkspaceScopedRepository } from '@/modules/workspaces/repositories/workspace-scoped.repository';
import { BLOCKING_STATUSES } from '../appointments/appointment-rules';

export type AppointmentWithRelations = Prisma.AppointmentGetPayload<{
  include: {
    client: { select: { id: true; name: true; phone: true } };
    order: {
      select: {
        id: true;
        number: true;
        title: true;
        status: true;
        vehicle: { select: { id: true; make: true; model: true; plate: true } };
      };
    };
    assignee: {
      select: {
        id: true;
        displayName: true;
        color: true;
        user: { select: { firstName: true; lastName: true } };
      };
    };
  };
}>;

const RELATIONS = {
  client: { select: { id: true, name: true, phone: true } },
  order: {
    select: {
      id: true,
      number: true,
      title: true,
      status: true,
      vehicle: { select: { id: true, make: true, model: true, plate: true } },
    },
  },
  assignee: {
    select: {
      id: true,
      displayName: true,
      color: true,
      user: { select: { firstName: true, lastName: true } },
    },
  },
} satisfies Prisma.AppointmentInclude;

export interface AppointmentRangeFilter {
  from: Date;
  to: Date;
  assigneeMemberId?: string;
  statuses?: AppointmentStatus[];
  orderId?: string;
}

@Injectable()
export class AppointmentsRepository extends WorkspaceScopedRepository {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  async findById(workspaceId: string, id: string): Promise<AppointmentWithRelations | null> {
    return this.prisma.appointment.findFirst({
      where: { id, workspaceId },
      include: RELATIONS,
    });
  }

  /** Записи, пересекающие диапазон: длинная запись видна в дне, в который попадает её середина. */
  async listRange(
    workspaceId: string,
    filter: AppointmentRangeFilter,
  ): Promise<AppointmentWithRelations[]> {
    return this.prisma.appointment.findMany({
      where: {
        workspaceId,
        startsAt: { lt: filter.to },
        endsAt: { gt: filter.from },
        ...(filter.assigneeMemberId ? { assigneeMemberId: filter.assigneeMemberId } : {}),
        ...(filter.orderId ? { orderId: filter.orderId } : {}),
        ...(filter.statuses?.length ? { status: { in: filter.statuses } } : {}),
      },
      include: RELATIONS,
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
    });
  }

  async listForOrder(workspaceId: string, orderId: string): Promise<AppointmentWithRelations[]> {
    return this.prisma.appointment.findMany({
      where: { workspaceId, orderId },
      include: RELATIONS,
      orderBy: { startsAt: 'asc' },
    });
  }

  /**
   * Записи того же исполнителя, пересекающие интервал.
   * Учитываются только статусы, которые занимают время.
   */
  async findConflicts(
    workspaceId: string,
    input: {
      assigneeMemberId: string;
      startsAt: Date;
      endsAt: Date;
      excludeId?: string;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<AppointmentWithRelations[]> {
    const client = tx ?? this.prisma;
    return client.appointment.findMany({
      where: {
        workspaceId,
        assigneeMemberId: input.assigneeMemberId,
        status: { in: [...BLOCKING_STATUSES] },
        startsAt: { lt: input.endsAt },
        endsAt: { gt: input.startsAt },
        ...(input.excludeId ? { id: { not: input.excludeId } } : {}),
      },
      include: RELATIONS,
      orderBy: { startsAt: 'asc' },
    });
  }

  /** Занятое время исполнителей в диапазоне — основа расчёта свободных слотов. */
  async busyRanges(
    workspaceId: string,
    input: { assigneeMemberId: string; from: Date; to: Date; excludeId?: string },
  ): Promise<{ startsAt: Date; endsAt: Date }[]> {
    return this.prisma.appointment.findMany({
      where: {
        workspaceId,
        assigneeMemberId: input.assigneeMemberId,
        status: { in: [...BLOCKING_STATUSES] },
        startsAt: { lt: input.to },
        endsAt: { gt: input.from },
        ...(input.excludeId ? { id: { not: input.excludeId } } : {}),
      },
      select: { startsAt: true, endsAt: true },
      orderBy: { startsAt: 'asc' },
    });
  }

  async create(
    workspaceId: string,
    data: Omit<Prisma.AppointmentUncheckedCreateInput, 'workspaceId'>,
    tx?: Prisma.TransactionClient,
  ): Promise<Appointment> {
    const client = tx ?? this.prisma;
    return client.appointment.create({ data: { ...data, workspaceId } });
  }

  async update(
    workspaceId: string,
    id: string,
    data: Prisma.AppointmentUncheckedUpdateInput,
    tx?: Prisma.TransactionClient,
  ): Promise<Appointment> {
    const client = tx ?? this.prisma;
    const existing = await client.appointment.findFirst({
      where: { id, workspaceId },
      select: { id: true },
    });
    if (!existing) {
      throw AppError.notFound('Запись не найдена');
    }
    const { workspaceId: _ignored, id: _id, ...safe } = data;
    void _ignored;
    void _id;
    return client.appointment.update({ where: { id }, data: safe });
  }

  /** Ближайшая активная запись заказа: из неё берётся `scheduled_start_at`. */
  async nextForOrder(
    workspaceId: string,
    orderId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<{ startsAt: Date } | null> {
    const client = tx ?? this.prisma;
    return client.appointment.findFirst({
      where: { workspaceId, orderId, status: { in: [...BLOCKING_STATUSES] } },
      select: { startsAt: true },
      orderBy: { startsAt: 'asc' },
    });
  }

  /** Отмена будущих записей заказа: вызывается при отмене самого заказа. */
  async cancelFutureForOrder(
    workspaceId: string,
    orderId: string,
    input: { reason: string; now: Date },
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const client = tx ?? this.prisma;
    const result = await client.appointment.updateMany({
      where: {
        workspaceId,
        orderId,
        status: { in: [...BLOCKING_STATUSES] },
        startsAt: { gte: input.now },
      },
      data: { status: 'cancelled', cancelReason: input.reason },
    });
    return result.count;
  }

  /**
   * Записи, по которым пора напомнить. Запрос идёт по всем мастерским сразу:
   * это фоновая задача, а не действие пользователя, поэтому workspaceId здесь нет.
   */
  async dueForReminder(
    from: Date,
    to: Date,
  ): Promise<
    (Appointment & {
      workspace: { id: string; name: string; timezone: string; settings: Prisma.JsonValue };
      client: { name: string } | null;
      assignee: { userId: string } | null;
      order: { id: string; vehicle: { make: string; model: string } | null } | null;
    })[]
  > {
    return this.prisma.appointment.findMany({
      where: {
        status: { in: [...BLOCKING_STATUSES] },
        startsAt: { gte: from, lte: to },
        assigneeMemberId: { not: null },
      },
      include: {
        workspace: { select: { id: true, name: true, timezone: true, settings: true } },
        client: { select: { name: true } },
        assignee: { select: { userId: true } },
        order: { select: { id: true, vehicle: { select: { make: true, model: true } } } },
      },
      orderBy: { startsAt: 'asc' },
      take: 500,
    });
  }
}
