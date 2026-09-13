import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Idempotent } from '@/common/interceptors/idempotency.interceptor';
import { zodBody } from '@/common/pipes/zod-validation.pipe';
import { Audited } from '@/modules/audit/audit.interceptor';
import { AllowExpiredAccess, Can, Workspace } from '@/modules/workspaces/guards/workspace.guard';
import { Ws } from '@/modules/workspaces/decorators/workspace.decorators';
import type { WorkspaceContext } from '@/modules/workspaces/workspace.types';
import { PaymentsService } from './payments.service';
import type { PaymentWithAuthor } from '../repositories/payments.repository';
import { createPaymentSchema, paymentJournalQuerySchema } from '../dto/crm.dto';

const KIND_LABELS: Record<string, string> = {
  payment: 'Оплата',
  refund: 'Возврат',
  correction: 'Корректировка',
};

const METHOD_LABELS: Record<string, string> = {
  cash: 'Наличные',
  card: 'Карта',
  transfer: 'Перевод',
  sbp: 'СБП',
  other: 'Другое',
};

const PURPOSE_LABELS: Record<string, string> = {
  prepayment: 'Предоплата',
  payment: 'Оплата',
  final: 'Доплата',
  refund: 'Возврат',
  correction: 'Корректировка',
};

function serializeEntry(entry: PaymentWithAuthor): Record<string, unknown> {
  return {
    id: entry.id,
    kind: entry.kind,
    kindLabel: KIND_LABELS[entry.kind] ?? entry.kind,
    amountMinor: Number(entry.amountMinor),
    /** Со знаком: возврат и корректировка уменьшают оплаченное. */
    signedAmountMinor:
      entry.kind === 'payment' ? Number(entry.amountMinor) : -Number(entry.amountMinor),
    currency: entry.currency,
    method: entry.method,
    methodLabel: METHOD_LABELS[entry.method] ?? entry.method,
    purpose: entry.purpose,
    purposeLabel: PURPOSE_LABELS[entry.purpose] ?? entry.purpose,
    occurredAt: entry.occurredAt.toISOString(),
    note: entry.note,
    correctsEntryId: entry.correctsEntryId,
    createdAt: entry.createdAt.toISOString(),
    createdBy: entry.createdBy
      ? [entry.createdBy.firstName, entry.createdBy.lastName].filter(Boolean).join(' ')
      : null,
  };
}

@ApiTags('crm')
@Controller('workspaces/:workspaceId')
@Workspace()
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get('orders/:orderId/payments')
  @Can('payments.read_own')
  @AllowExpiredAccess()
  @ApiOperation({ summary: 'Оплаты заказа и остаток' })
  async list(@Ws() ws: WorkspaceContext, @Param('orderId') orderId: string) {
    const view = await this.payments.listForOrder(ws, orderId);
    return {
      currency: view.currency,
      agreedTotalMinor: view.agreedTotalMinor,
      paidMinor: view.paidMinor,
      remainingMinor: view.remainingMinor,
      paymentStatus: view.paymentStatus,
      entries: view.entries.map(serializeEntry),
    };
  }

  @Post('orders/:orderId/payments')
  @Can('payments.write_own')
  @Idempotent()
  @Audited({ entityType: 'payment_entry', action: 'create', idFrom: { responseField: 'id' } })
  @ApiOperation({ summary: 'Новая запись оплаты, возврата или корректировки' })
  async create(
    @Ws() ws: WorkspaceContext,
    @Param('orderId') orderId: string,
    @Body(zodBody(createPaymentSchema)) body: Record<string, never>,
  ) {
    const { entry, order } = await this.payments.create(ws, orderId, body as never);
    return {
      id: entry.id,
      amountMinor: Number(entry.amountMinor),
      kind: entry.kind,
      paidMinor: Number(order.paidMinor),
      paymentStatus: order.paymentStatus,
      remainingMinor:
        order.agreedTotalMinor === null
          ? 0
          : Number(order.agreedTotalMinor) - Number(order.paidMinor),
    };
  }

  @Get('payments')
  @Can('payments.read_all')
  @AllowExpiredAccess()
  @ApiOperation({ summary: 'Журнал оплат мастерской' })
  async journal(@Ws() ws: WorkspaceContext, @Query() query: Record<string, string>) {
    const parsed = paymentJournalQuerySchema.parse(query);
    const result = await this.payments.journal(ws, parsed);
    return {
      items: result.items.map((entry) => ({
        ...serializeEntry(entry),
        order: {
          id: entry.order.id,
          number: entry.order.number,
          clientName: entry.order.client.name,
        },
      })),
      nextCursor: result.nextCursor,
      totals: result.totals,
    };
  }
}
