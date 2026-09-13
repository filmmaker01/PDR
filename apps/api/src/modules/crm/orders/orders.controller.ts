import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Idempotent } from '@/common/interceptors/idempotency.interceptor';
import { zodBody } from '@/common/pipes/zod-validation.pipe';
import { Audited } from '@/modules/audit/audit.interceptor';
import { AllowExpiredAccess, Can, Workspace } from '@/modules/workspaces/guards/workspace.guard';
import { Ws } from '@/modules/workspaces/decorators/workspace.decorators';
import type { WorkspaceContext } from '@/modules/workspaces/workspace.types';
import { OrdersService } from './orders.service';
import { allowedFrom, ORDER_STATUS_LABELS } from './order-state-machine';
import {
  archiveSchema,
  createOrderSchema,
  orderListQuerySchema,
  transitionSchema,
  updateOrderSchema,
} from '../dto/crm.dto';
import type { OrderWithRelations } from '../repositories/orders.repository';

function serializeListItem(order: OrderWithRelations): Record<string, unknown> {
  return {
    id: order.id,
    number: order.number,
    status: order.status,
    statusLabel: ORDER_STATUS_LABELS[order.status],
    paymentStatus: order.paymentStatus,
    title: order.title,
    agreedTotalMinor: order.agreedTotalMinor === null ? null : Number(order.agreedTotalMinor),
    paidMinor: Number(order.paidMinor),
    currency: order.currency,
    client: { id: order.client.id, name: order.client.name, phone: order.client.phone },
    vehicle: order.vehicle
      ? {
          id: order.vehicle.id,
          make: order.vehicle.make,
          model: order.vehicle.model,
          plate: order.vehicle.plate,
        }
      : null,
    assignee: order.assignee
      ? {
          id: order.assignee.id,
          name:
            order.assignee.displayName ??
            [order.assignee.user.firstName, order.assignee.user.lastName].filter(Boolean).join(' '),
          color: order.assignee.color,
        }
      : null,
    scheduledStartAt: order.scheduledStartAt?.toISOString() ?? null,
    createdAt: order.createdAt.toISOString(),
  };
}

@ApiTags('crm')
@Controller('workspaces/:workspaceId')
@Workspace()
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get('today')
  @Can('orders.read_own')
  @AllowExpiredAccess()
  @ApiOperation({ summary: 'Сводка «Сегодня»' })
  async today(@Ws() ws: WorkspaceContext) {
    return this.orders.summary(ws);
  }

  @Get('debts')
  @Can('orders.read_own')
  @AllowExpiredAccess()
  @ApiOperation({ summary: 'Заказы с задолженностью' })
  async debts(@Ws() ws: WorkspaceContext) {
    return this.orders.debts(ws);
  }

  @Get('orders')
  @Can('orders.read_own')
  @AllowExpiredAccess()
  @ApiOperation({ summary: 'Заказы с поиском и фильтрами' })
  async list(@Ws() ws: WorkspaceContext, @Query() query: Record<string, string>) {
    const parsed = orderListQuerySchema.parse(query);
    const result = await this.orders.list(ws, {
      statuses: parsed.status,
      assigneeMemberId: parsed.assigneeMemberId,
      paymentStatus: parsed.paymentStatus,
      q: parsed.q,
      from: parsed.from,
      to: parsed.to,
      archived: parsed.archived,
      limit: parsed.limit,
      cursor: parsed.cursor,
    });
    return { items: result.items.map(serializeListItem), nextCursor: result.nextCursor };
  }

  @Post('orders')
  @Can('orders.create')
  @Idempotent()
  @Audited({ entityType: 'order', action: 'create', idFrom: { responseField: 'id' } })
  @ApiOperation({ summary: 'Новый заказ вместе с клиентом и автомобилем' })
  async create(
    @Ws() ws: WorkspaceContext,
    @Body(zodBody(createOrderSchema)) body: Record<string, never>,
  ) {
    const order = await this.orders.create(ws, body as never);
    return { id: order.id, number: order.number, status: order.status };
  }

  @Get('orders/:orderId')
  @Can('orders.read_own')
  @AllowExpiredAccess()
  @ApiOperation({ summary: 'Карточка заказа' })
  async get(@Ws() ws: WorkspaceContext, @Param('orderId') orderId: string) {
    const order = await this.orders.getById(ws, orderId);
    const history = await this.orders.history(ws, orderId);

    return {
      ...serializeListItem(order),
      damageSummary: order.damageSummary,
      internalNotes: order.internalNotes,
      clientNotes: order.clientNotes,
      startedAt: order.startedAt?.toISOString() ?? null,
      readyAt: order.readyAt?.toISOString() ?? null,
      deliveredAt: order.deliveredAt?.toISOString() ?? null,
      cancelledAt: order.cancelledAt?.toISOString() ?? null,
      cancelReason: order.cancelReason,
      archivedAt: order.archivedAt?.toISOString() ?? null,
      debtMinor: Number((order.agreedTotalMinor ?? 0n) - order.paidMinor),
      allowedTransitions: allowedFrom(order.status).map((status) => ({
        status,
        label: ORDER_STATUS_LABELS[status],
      })),
      history: history.map((entry) => ({
        id: entry.id,
        fromStatus: entry.fromStatus,
        toStatus: entry.toStatus,
        comment: entry.comment,
        createdAt: entry.createdAt.toISOString(),
        changedBy: entry.changedBy
          ? [entry.changedBy.firstName, entry.changedBy.lastName].filter(Boolean).join(' ')
          : 'система',
      })),
    };
  }

  @Patch('orders/:orderId')
  @Can('orders.write_own')
  @Audited({ entityType: 'order', idFrom: { param: 'orderId' } })
  @ApiOperation({ summary: 'Изменение заказа' })
  async update(
    @Ws() ws: WorkspaceContext,
    @Param('orderId') orderId: string,
    @Body(zodBody(updateOrderSchema)) body: Record<string, never>,
  ) {
    const order = await this.orders.update(ws, orderId, body as never);
    return { id: order.id, title: order.title, assigneeMemberId: order.assigneeMemberId };
  }

  @Post('orders/:orderId/transition')
  @Can('orders.write_own')
  @Audited({ entityType: 'order', action: 'status_change', idFrom: { param: 'orderId' } })
  @ApiOperation({ summary: 'Смена статуса заказа' })
  async transition(
    @Ws() ws: WorkspaceContext,
    @Param('orderId') orderId: string,
    @Body(zodBody(transitionSchema)) body: { to: never; comment?: string | null },
  ) {
    const order = await this.orders.transition(ws, orderId, body.to, body.comment);
    return {
      id: order.id,
      status: order.status,
      statusLabel: ORDER_STATUS_LABELS[order.status],
      allowedTransitions: allowedFrom(order.status).map((status) => ({
        status,
        label: ORDER_STATUS_LABELS[status],
      })),
    };
  }

  @Post('orders/:orderId/archive')
  @Can('orders.manage')
  @Audited({ entityType: 'order', action: 'archive', idFrom: { param: 'orderId' } })
  @ApiOperation({ summary: 'Архивирование заказа' })
  async archive(
    @Ws() ws: WorkspaceContext,
    @Param('orderId') orderId: string,
    @Body(zodBody(archiveSchema)) body: { archived: boolean },
  ) {
    const order = await this.orders.archive(ws, orderId, body.archived);
    return { id: order.id, archivedAt: order.archivedAt?.toISOString() ?? null };
  }

  @Get('orders/:orderId/history')
  @Can('orders.read_own')
  @AllowExpiredAccess()
  @ApiOperation({ summary: 'История статусов заказа' })
  async history(@Ws() ws: WorkspaceContext, @Param('orderId') orderId: string) {
    const history = await this.orders.history(ws, orderId);
    return history.map((entry) => ({
      id: entry.id,
      fromStatus: entry.fromStatus,
      toStatus: entry.toStatus,
      comment: entry.comment,
      createdAt: entry.createdAt.toISOString(),
      changedBy: entry.changedBy
        ? [entry.changedBy.firstName, entry.changedBy.lastName].filter(Boolean).join(' ')
        : 'система',
    }));
  }
}
