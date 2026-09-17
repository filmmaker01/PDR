import { Injectable, Logger } from '@nestjs/common';
import type { Order, OrderStatus, Prisma } from '@prisma/client';
import { ownsRecord } from '@pdr/shared';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { AppError } from '@/common/errors/app.error';
import { NotificationsService } from '@/modules/notifications/notifications.service';
import { WorkspacesService } from '@/modules/workspaces/workspaces.service';
import type { WorkspaceContext } from '@/modules/workspaces/workspace.types';
import { ClientsRepository } from '../repositories/clients.repository';
import { VehiclesRepository } from '../repositories/vehicles.repository';
import {
  OrdersRepository,
  type OrderListFilter,
  type OrderWithRelations,
} from '../repositories/orders.repository';
import { AppointmentsService } from '../appointments/appointments.service';
import {
  allowedFrom,
  canTransition,
  isOwnerOnlyTransition,
  timestampsFor,
} from './order-state-machine';

export interface OrderTransitionEvent {
  workspaceId: string;
  orderId: string;
  to: OrderStatus;
  tx: Prisma.TransactionClient;
}

export type OrderTransitionListener = (event: OrderTransitionEvent) => Promise<void>;

export interface CreateOrderInput {
  clientId?: string;
  newClient?: { name: string; phone?: string | null };
  vehicleId?: string;
  newVehicle?: {
    make: string;
    model: string;
    plate?: string | null;
    year?: number | null;
    color?: string | null;
  };
  title?: string | null;
  damageSummary?: string | null;
  assigneeMemberId?: string | null;
  internalNotes?: string | null;
  /** Первая запись в календарь: создаётся вместе с заказом. */
  appointment?: {
    startsAtLocal: string;
    durationMin: number;
    kind?: 'inspection' | 'repair' | 'delivery' | 'other';
    note?: string | null;
    allowOverlap?: boolean;
  };
}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);
  /**
   * Подписчики на смену статуса. Нужны, чтобы смежные области
   * (календарь, оплаты) реагировали на переход внутри той же транзакции,
   * не превращая заказы в зависимость от их таблиц.
   */
  private readonly transitionListeners: OrderTransitionListener[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersRepository,
    private readonly clients: ClientsRepository,
    private readonly vehicles: VehiclesRepository,
    private readonly workspaces: WorkspacesService,
    private readonly notifications: NotificationsService,
    private readonly appointments: AppointmentsService,
  ) {}

  onTransition(listener: OrderTransitionListener): void {
    this.transitionListeners.push(listener);
  }

  /** Фильтр списка с учётом права сотрудника видеть чужие заказы. */
  private scopeFilter(ctx: WorkspaceContext, filter: OrderListFilter): OrderListFilter {
    if (ctx.permissions.has('orders.read_all')) return filter;
    return {
      ...filter,
      onlyForMember: { memberId: ctx.member.id, userId: ctx.userId },
    };
  }

  async list(ctx: WorkspaceContext, filter: OrderListFilter) {
    return this.orders.list(ctx.workspaceId, this.scopeFilter(ctx, filter));
  }

  async getById(ctx: WorkspaceContext, orderId: string): Promise<OrderWithRelations> {
    const order = await this.orders.findById(ctx.workspaceId, orderId);
    if (!order) throw AppError.notFound('Заказ не найден');
    this.assertCanSee(ctx, order);
    return order;
  }

  /** Сотрудник без права видеть все заказы работает только со своими. */
  private assertCanSee(ctx: WorkspaceContext, order: Order): void {
    if (ctx.permissions.has('orders.read_all')) return;
    if (!ownsRecord({ memberId: ctx.member.id, userId: ctx.userId }, order)) {
      throw AppError.notFound('Заказ не найден');
    }
  }

  private assertCanEdit(ctx: WorkspaceContext, order: Order): void {
    if (ctx.permissions.has('orders.write_all')) return;
    if (!ownsRecord({ memberId: ctx.member.id, userId: ctx.userId }, order)) {
      throw AppError.notFound('Заказ не найден');
    }
  }

  /**
   * Создание заказа одной транзакцией: клиент, автомобиль и заказ
   * появляются вместе или не появляются вовсе.
   */
  async create(ctx: WorkspaceContext, input: CreateOrderInput): Promise<Order> {
    if (!input.clientId && !input.newClient) {
      throw AppError.validation('Выберите клиента или создайте нового');
    }

    const assigneeMemberId = await this.resolveAssignee(ctx, input.assigneeMemberId);

    return this.prisma.transaction(async (tx) => {
      let clientId = input.clientId;
      if (!clientId && input.newClient) {
        const { normalizePhone } = await import('@pdr/shared');
        const phone = input.newClient.phone ? normalizePhone(input.newClient.phone) : null;
        if (input.newClient.phone && !phone) {
          throw AppError.validation('Не удалось разобрать номер телефона');
        }
        const created = await tx.client.create({
          data: {
            workspaceId: ctx.workspaceId,
            name: input.newClient.name.trim(),
            phone,
            createdById: ctx.userId,
          },
        });
        clientId = created.id;
      } else {
        const existing = await tx.client.findFirst({
          where: { id: clientId, workspaceId: ctx.workspaceId },
          select: { id: true },
        });
        if (!existing) throw AppError.notFound('Клиент не найден');
      }

      let vehicleId = input.vehicleId ?? null;
      if (!vehicleId && input.newVehicle) {
        const { normalizePlate } = await import('@pdr/shared');
        const created = await tx.vehicle.create({
          data: {
            workspaceId: ctx.workspaceId,
            clientId: clientId!,
            make: input.newVehicle.make.trim(),
            model: input.newVehicle.model.trim(),
            year: input.newVehicle.year ?? null,
            color: input.newVehicle.color ?? null,
            plate: normalizePlate(input.newVehicle.plate ?? null),
          },
        });
        vehicleId = created.id;
      } else if (vehicleId) {
        const existing = await tx.vehicle.findFirst({
          where: { id: vehicleId, workspaceId: ctx.workspaceId, clientId },
          select: { id: true },
        });
        if (!existing) {
          throw AppError.validation('Автомобиль не найден у этого клиента');
        }
      }

      const number = await this.workspaces.nextOrderNumber(ctx.workspaceId, tx);

      const order = await tx.order.create({
        data: {
          workspaceId: ctx.workspaceId,
          number,
          clientId: clientId!,
          vehicleId,
          assigneeMemberId,
          status: 'new',
          paymentStatus: 'unpaid',
          currency: ctx.workspace.currency,
          title: input.title ?? null,
          damageSummary: input.damageSummary ?? null,
          internalNotes: input.internalNotes ?? null,
          createdById: ctx.userId,
        },
      });

      await tx.orderStatusHistory.create({
        data: {
          workspaceId: ctx.workspaceId,
          orderId: order.id,
          fromStatus: null,
          toStatus: 'new',
          changedById: ctx.userId,
          comment: 'Заказ создан',
        },
      });

      // Заказ и первая запись появляются вместе: запись без заказа
      // после ошибки оставила бы календарь рассинхронизированным.
      if (input.appointment) {
        await this.appointments.createWithin(tx, ctx, {
          orderId: order.id,
          clientId: clientId!,
          assigneeMemberId,
          startsAtLocal: input.appointment.startsAtLocal,
          durationMin: input.appointment.durationMin,
          kind: input.appointment.kind ?? 'inspection',
          note: input.appointment.note ?? null,
          allowOverlap: input.appointment.allowOverlap,
        });
      }

      return order;
    });
  }

  async update(
    ctx: WorkspaceContext,
    orderId: string,
    input: {
      title?: string | null;
      damageSummary?: string | null;
      internalNotes?: string | null;
      clientNotes?: string | null;
      vehicleId?: string | null;
      assigneeMemberId?: string | null;
    },
  ): Promise<Order> {
    const order = await this.getById(ctx, orderId);
    this.assertCanEdit(ctx, order);

    const data: Prisma.OrderUncheckedUpdateInput = {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.damageSummary !== undefined ? { damageSummary: input.damageSummary } : {}),
      ...(input.internalNotes !== undefined ? { internalNotes: input.internalNotes } : {}),
      ...(input.clientNotes !== undefined ? { clientNotes: input.clientNotes } : {}),
    };

    if (input.vehicleId !== undefined) {
      if (input.vehicleId !== null) {
        const vehicle = await this.vehicles.findById(ctx.workspaceId, input.vehicleId);
        if (!vehicle || vehicle.clientId !== order.clientId) {
          throw AppError.validation('Автомобиль не найден у этого клиента');
        }
      }
      data.vehicleId = input.vehicleId;
    }

    if (input.assigneeMemberId !== undefined) {
      if (!ctx.permissions.has('orders.assign')) {
        throw AppError.forbidden('Назначать исполнителя может только владелец мастерской');
      }
      const memberId = await this.resolveAssignee(ctx, input.assigneeMemberId, true);
      data.assigneeMemberId = memberId;

      if (memberId && memberId !== order.assigneeMemberId) {
        await this.notifyAssignment(ctx, order, memberId);
      }
    }

    return this.orders.update(ctx.workspaceId, orderId, data);
  }

  /** Переход статуса: проверка допустимости, история, побочные эффекты. */
  async transition(
    ctx: WorkspaceContext,
    orderId: string,
    to: OrderStatus,
    comment?: string | null,
  ): Promise<Order> {
    const order = await this.getById(ctx, orderId);
    this.assertCanEdit(ctx, order);

    if (order.status === to) return order;

    if (!canTransition(order.status, to)) {
      throw new AppError(
        'invalid_transition',
        `Заказ нельзя перевести из «${this.label(order.status)}» в «${this.label(to)}»`,
        { allowed: allowedFrom(order.status) },
      );
    }

    if (isOwnerOnlyTransition(order.status, to) && ctx.role !== 'owner') {
      throw AppError.forbidden('Это действие доступно только владельцу мастерской');
    }

    if (to === 'cancelled' && !comment?.trim()) {
      throw AppError.validation('Укажите причину отмены');
    }

    return this.prisma.transaction(async (tx) => {
      const updated = await tx.order.update({
        where: { id: orderId },
        data: {
          status: to,
          ...timestampsFor(to),
          ...(to === 'cancelled' ? { cancelReason: comment ?? null } : {}),
        },
      });

      await tx.orderStatusHistory.create({
        data: {
          workspaceId: ctx.workspaceId,
          orderId,
          fromStatus: order.status,
          toStatus: to,
          changedById: ctx.userId,
          comment: comment ?? null,
        },
      });

      // Отмена будущих записей в календаре выполняется подписчиком
      // (модуль календаря), чтобы заказы не зависели от его таблиц напрямую.
      for (const listener of this.transitionListeners) {
        await listener({ workspaceId: ctx.workspaceId, orderId, to, tx });
      }

      return updated;
    });
  }

  async archive(ctx: WorkspaceContext, orderId: string, archived: boolean): Promise<Order> {
    await this.getById(ctx, orderId);
    if (!ctx.permissions.has('orders.manage')) {
      throw AppError.forbidden('Архивировать заказы может только владелец мастерской');
    }
    return this.orders.update(ctx.workspaceId, orderId, {
      archivedAt: archived ? new Date() : null,
    });
  }

  async history(ctx: WorkspaceContext, orderId: string) {
    await this.getById(ctx, orderId);
    return this.orders.history(ctx.workspaceId, orderId);
  }

  /**
   * Сводка «Сегодня»: что в работе и что готово к выдаче.
   *
   * Задолженности здесь нет намеренно: в PDR-мастерской работы оплачиваются
   * сразу, и показатель «сколько нам должны» только отвлекал. Учёт оплат
   * при этом никуда не делся — он живёт в карточке заказа и журнале оплат.
   */
  async summary(ctx: WorkspaceContext) {
    const filter = this.scopeFilter(ctx, { limit: 1 });

    const [activeCount, readyCount] = await Promise.all([
      this.orders.count(ctx.workspaceId, { ...filter, statuses: ['in_progress'] }),
      this.orders.count(ctx.workspaceId, { ...filter, statuses: ['ready'] }),
    ]);

    return { activeCount, readyCount, currency: ctx.workspace.currency };
  }

  private async resolveAssignee(
    ctx: WorkspaceContext,
    requested: string | null | undefined,
    allowNull = false,
  ): Promise<string | null> {
    if (requested === null && allowNull) return null;

    if (requested === undefined || requested === null) {
      // По умолчанию исполнитель — тот, кто создаёт заказ.
      return ctx.member.id;
    }

    if (requested !== ctx.member.id && !ctx.permissions.has('orders.assign')) {
      throw AppError.forbidden('Назначать другого исполнителя может только владелец мастерской');
    }

    const member = await this.prisma.workspaceMember.findFirst({
      where: { id: requested, workspaceId: ctx.workspaceId, isActive: true },
      select: { id: true },
    });
    if (!member) throw AppError.validation('Сотрудник не найден или деактивирован');
    return member.id;
  }

  private async notifyAssignment(
    ctx: WorkspaceContext,
    order: Order,
    memberId: string,
  ): Promise<void> {
    const member = await this.prisma.workspaceMember.findUnique({
      where: { id: memberId },
      select: { userId: true },
    });
    if (!member || member.userId === ctx.userId) return;

    await this.notifications.notify({
      userId: member.userId,
      type: 'order_assigned',
      payload: {
        orderNumber: order.number,
        title: order.title ?? 'Без описания',
        orderId: order.id,
        workspaceId: ctx.workspaceId,
      },
      dedupeKey: `order_assigned:${order.id}:${memberId}`,
    });
  }

  private label(status: OrderStatus): string {
    const labels: Record<OrderStatus, string> = {
      new: 'Новый',
      pending_approval: 'На согласовании',
      scheduled: 'Запланирован',
      in_progress: 'В работе',
      ready: 'Готов',
      delivered: 'Выдан',
      cancelled: 'Отменён',
    };
    return labels[status];
  }
}
