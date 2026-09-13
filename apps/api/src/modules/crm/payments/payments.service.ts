import { Injectable } from '@nestjs/common';
import type {
  Order,
  PaymentEntry,
  PaymentKind,
  PaymentMethod,
  PaymentPurpose,
  Prisma,
} from '@prisma/client';
import { calcPaymentStatus, ownsRecord } from '@pdr/shared';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { AppError } from '@/common/errors/app.error';
import type { WorkspaceContext } from '@/modules/workspaces/workspace.types';
import { OrdersRepository } from '../repositories/orders.repository';
import {
  PaymentsRepository,
  type PaymentJournalFilter,
  type PaymentWithAuthor,
} from '../repositories/payments.repository';

export interface CreatePaymentInput {
  kind?: PaymentKind;
  amountMinor: number;
  method?: PaymentMethod;
  purpose?: PaymentPurpose;
  occurredAt?: Date;
  note?: string | null;
  correctsEntryId?: string | null;
}

export interface OrderPaymentsView {
  currency: string;
  agreedTotalMinor: number | null;
  paidMinor: number;
  remainingMinor: number;
  paymentStatus: string;
  entries: PaymentWithAuthor[];
}

/** Сутки вперёд: оплату иногда проводят «завтрашней» датой из-за часового пояса. */
const MAX_FUTURE_MS = 86_400_000;

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsRepository,
    private readonly orders: OrdersRepository,
  ) {}

  async listForOrder(ctx: WorkspaceContext, orderId: string): Promise<OrderPaymentsView> {
    const order = await this.orderFor(ctx, orderId);
    const entries = await this.payments.listForOrder(ctx.workspaceId, orderId);
    const agreed = order.agreedTotalMinor === null ? null : Number(order.agreedTotalMinor);
    const paid = Number(order.paidMinor);

    return {
      currency: order.currency,
      agreedTotalMinor: agreed,
      paidMinor: paid,
      remainingMinor: agreed === null ? 0 : agreed - paid,
      paymentStatus: order.paymentStatus,
      entries,
    };
  }

  /**
   * Новая запись оплаты. Записи не изменяются и не удаляются:
   * ошибка исправляется корректировкой, поэтому история денег полная.
   */
  async create(
    ctx: WorkspaceContext,
    orderId: string,
    input: CreatePaymentInput,
  ): Promise<{ entry: PaymentEntry; order: Order }> {
    const order = await this.orderFor(ctx, orderId);
    this.assertCanWrite(ctx, order);

    const kind = input.kind ?? 'payment';
    const amount = Math.trunc(input.amountMinor);
    if (amount <= 0) throw AppError.validation('Сумма должна быть больше нуля');

    const occurredAt = input.occurredAt ?? new Date();
    if (occurredAt.getTime() > Date.now() + MAX_FUTURE_MS) {
      throw AppError.validation('Дата оплаты не может быть в будущем');
    }

    if (kind === 'payment' && input.correctsEntryId) {
      throw AppError.validation(
        'Ссылка на исправляемую запись есть только у возврата и корректировки',
      );
    }

    return this.prisma.transaction(async (tx) => {
      if (input.correctsEntryId) {
        const target = await this.payments.findById(ctx.workspaceId, input.correctsEntryId, tx);
        if (!target || target.orderId !== orderId) {
          throw AppError.validation('Исправляемая запись не найдена в этом заказе');
        }
      }

      const entry = await this.payments.create(
        ctx.workspaceId,
        {
          orderId,
          kind,
          amountMinor: BigInt(amount),
          currency: order.currency,
          method: input.method ?? 'cash',
          purpose: input.purpose ?? this.defaultPurpose(kind, order),
          occurredAt,
          note: input.note ?? null,
          correctsEntryId: input.correctsEntryId ?? null,
          createdById: ctx.userId,
        },
        tx,
      );

      const updated = await this.recalculate(ctx.workspaceId, order, tx);
      return { entry, order: updated };
    });
  }

  /** Журнал оплат мастерской за период. */
  async journal(
    ctx: WorkspaceContext,
    filter: PaymentJournalFilter,
  ): Promise<{
    items: Awaited<ReturnType<PaymentsRepository['journal']>>['items'];
    nextCursor: string | null;
    totals: { kind: string; method: string; totalMinor: number }[];
  }> {
    if (!ctx.permissions.has('payments.read_all')) {
      throw AppError.forbidden('Журнал оплат доступен владельцу мастерской');
    }
    const result = await this.payments.journal(ctx.workspaceId, filter);
    const totals =
      filter.from && filter.to
        ? await this.payments.periodTotals(ctx.workspaceId, { from: filter.from, to: filter.to })
        : [];
    return { ...result, totals };
  }

  /**
   * Пересчёт оплаченного по заказу из самих записей, а не приращением:
   * так расхождение невозможно даже после ручного исправления данных.
   */
  private async recalculate(
    workspaceId: string,
    order: Order,
    tx: Prisma.TransactionClient,
  ): Promise<Order> {
    const totals = await this.payments.totalsByKind(workspaceId, order.id, tx);
    const paid =
      (totals.payment ?? BigInt(0)) -
      (totals.refund ?? BigInt(0)) -
      (totals.correction ?? BigInt(0));

    if (paid < BigInt(0)) {
      throw AppError.validation('Возврат больше полученной суммы');
    }

    const agreed = order.agreedTotalMinor === null ? null : Number(order.agreedTotalMinor);
    return this.orders.update(
      workspaceId,
      order.id,
      {
        paidMinor: paid,
        paymentStatus: calcPaymentStatus(agreed, Number(paid)),
      },
      tx,
    );
  }

  /** Назначение по умолчанию: предоплата до начала работ, доплата после. */
  private defaultPurpose(kind: PaymentKind, order: Order): PaymentPurpose {
    if (kind === 'refund') return 'refund';
    if (kind === 'correction') return 'correction';
    if (Number(order.paidMinor) === 0 && order.status !== 'delivered') return 'prepayment';
    if (order.status === 'ready' || order.status === 'delivered') return 'final';
    return 'payment';
  }

  private async orderFor(ctx: WorkspaceContext, orderId: string): Promise<Order> {
    const order = await this.orders.findById(ctx.workspaceId, orderId);
    if (!order) throw AppError.notFound('Заказ не найден');
    if (!ctx.permissions.has('orders.read_all')) {
      if (!ownsRecord({ memberId: ctx.member.id, userId: ctx.userId }, order)) {
        throw AppError.notFound('Заказ не найден');
      }
    }
    return order;
  }

  private assertCanWrite(ctx: WorkspaceContext, order: Order): void {
    if (ctx.permissions.has('payments.write_all')) return;
    if (!ctx.permissions.has('payments.write_own')) {
      throw AppError.forbidden('Принимать оплату в этой мастерской может только владелец');
    }
    if (!ownsRecord({ memberId: ctx.member.id, userId: ctx.userId }, order)) {
      throw AppError.notFound('Заказ не найден');
    }
  }
}
