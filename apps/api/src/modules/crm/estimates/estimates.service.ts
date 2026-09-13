import { Injectable } from '@nestjs/common';
import type {
  AccessDifficulty,
  DiscountKind,
  Estimate,
  EstimateItemKind,
  Material,
  Order,
  Prisma,
} from '@prisma/client';
import {
  calcEstimateTotals,
  calcPaymentStatus,
  defaultItemTitle,
  lineTotal,
  ownsRecord,
  type DiscountInput,
} from '@pdr/shared';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { AppError } from '@/common/errors/app.error';
import type { WorkspaceContext } from '@/modules/workspaces/workspace.types';
import { OrdersRepository } from '../repositories/orders.repository';
import { PriceListRepository } from '../repositories/price-list.repository';
import { EstimatesRepository, type EstimateWithItems } from '../repositories/estimates.repository';
import {
  ESTIMATE_STATUS_LABELS,
  canVersion,
  isEstimateEditable,
  supersedesSourceOnNewVersion,
} from './estimate-rules';

export interface EstimateItemInput {
  kind?: EstimateItemKind;
  title?: string | null;
  panelCode?: string | null;
  damageType?: string | null;
  sizeClass?: string | null;
  quantity?: number;
  material?: Material | null;
  accessDifficulty?: AccessDifficulty | null;
  onEdge?: boolean;
  /** Цена за единицу. Если не указана, берётся из позиции прайса. */
  unitPriceMinor?: number;
  priceListItemId?: string | null;
  comment?: string | null;
}

export interface EstimateSettingsInput {
  discountKind?: DiscountKind;
  discountValue?: number;
  noteForClient?: string | null;
  internalNote?: string | null;
}

@Injectable()
export class EstimatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly estimates: EstimatesRepository,
    private readonly orders: OrdersRepository,
    private readonly priceList: PriceListRepository,
  ) {}

  // ── Чтение ────────────────────────────────────────────────────────────────

  async listForOrder(ctx: WorkspaceContext, orderId: string): Promise<EstimateWithItems[]> {
    await this.orderFor(ctx, orderId);
    return this.estimates.listForOrder(ctx.workspaceId, orderId);
  }

  async getById(ctx: WorkspaceContext, estimateId: string): Promise<EstimateWithItems> {
    const estimate = await this.estimates.findById(ctx.workspaceId, estimateId);
    if (!estimate) throw AppError.notFound('Смета не найдена');
    // Видимость сметы повторяет видимость заказа: чужой заказ — чужая смета.
    await this.orderFor(ctx, estimate.orderId);
    return estimate;
  }

  // ── Создание и правка ─────────────────────────────────────────────────────

  async create(
    ctx: WorkspaceContext,
    orderId: string,
    input: { fromEstimateId?: string | null } = {},
  ): Promise<Estimate> {
    const order = await this.orderFor(ctx, orderId);
    this.assertCanWrite(ctx, order);

    return this.prisma.transaction(async (tx) => {
      const existingDraft = await this.estimates.findDraftForOrder(ctx.workspaceId, orderId, tx);
      if (existingDraft) {
        throw new AppError('conflict', 'У заказа уже есть черновик сметы', {
          estimateId: existingDraft.id,
          versionNo: existingDraft.versionNo,
        });
      }

      const source = input.fromEstimateId
        ? await this.estimates.findById(ctx.workspaceId, input.fromEstimateId, tx)
        : null;
      if (input.fromEstimateId && (!source || source.orderId !== orderId)) {
        throw AppError.notFound('Смета-источник не найдена');
      }

      return this.createDraft(tx, ctx, order, source);
    });
  }

  /** Новая версия: копия позиций в свежий черновик. */
  async newVersion(ctx: WorkspaceContext, estimateId: string): Promise<Estimate> {
    const source = await this.getById(ctx, estimateId);
    const order = await this.orderFor(ctx, source.orderId);
    this.assertCanWrite(ctx, order);

    if (!canVersion(source.status)) {
      throw new AppError(
        'invalid_transition',
        `Новую версию делают из отправленной, согласованной или отклонённой сметы, а эта — «${ESTIMATE_STATUS_LABELS[source.status]}»`,
      );
    }

    return this.prisma.transaction(async (tx) => {
      const existingDraft = await this.estimates.findDraftForOrder(ctx.workspaceId, order.id, tx);
      if (existingDraft) {
        throw new AppError('conflict', 'У заказа уже есть черновик сметы', {
          estimateId: existingDraft.id,
          versionNo: existingDraft.versionNo,
        });
      }

      const draft = await this.createDraft(tx, ctx, order, source);

      if (supersedesSourceOnNewVersion(source.status)) {
        await this.estimates.update(ctx.workspaceId, source.id, { status: 'superseded' }, tx);
      }
      return draft;
    });
  }

  async updateSettings(
    ctx: WorkspaceContext,
    estimateId: string,
    input: EstimateSettingsInput,
  ): Promise<Estimate> {
    const estimate = await this.getById(ctx, estimateId);
    const order = await this.orderFor(ctx, estimate.orderId);
    this.assertCanWrite(ctx, order);
    this.assertEditable(estimate);

    const discount: DiscountInput = {
      kind: input.discountKind ?? estimate.discountKind,
      value: input.discountValue ?? estimate.discountValue,
    } as DiscountInput;
    this.assertDiscount(discount);

    const totals = calcEstimateTotals(
      estimate.items.map((item) => ({
        quantity: item.quantity,
        unitPriceMinor: Number(item.unitPriceMinor),
      })),
      discount,
    );

    return this.estimates.update(ctx.workspaceId, estimateId, {
      discountKind: discount.kind,
      discountValue: discount.kind === 'none' ? 0 : (discount.value ?? 0),
      discountMinor: BigInt(totals.discountMinor),
      subtotalMinor: BigInt(totals.subtotalMinor),
      totalMinor: BigInt(totals.totalMinor),
      ...(input.noteForClient !== undefined ? { noteForClient: input.noteForClient } : {}),
      ...(input.internalNote !== undefined ? { internalNote: input.internalNote } : {}),
    });
  }

  /** Полная замена позиций: смета правится целиком, сервер считает итоги сам. */
  async replaceItems(
    ctx: WorkspaceContext,
    estimateId: string,
    items: EstimateItemInput[],
  ): Promise<EstimateWithItems> {
    const estimate = await this.getById(ctx, estimateId);
    const order = await this.orderFor(ctx, estimate.orderId);
    this.assertCanWrite(ctx, order);
    this.assertEditable(estimate);

    const priceItems = await this.priceList.findManyByIds(
      ctx.workspaceId,
      items.map((i) => i.priceListItemId).filter((id): id is string => Boolean(id)),
    );
    const priceById = new Map(priceItems.map((item) => [item.id, item]));

    const prepared = items.map((item, index) => {
      const source = item.priceListItemId ? priceById.get(item.priceListItemId) : undefined;
      if (item.priceListItemId && !source) {
        throw AppError.validation('Позиция прайса не найдена');
      }

      const unitPriceMinor =
        item.unitPriceMinor ?? (source ? Number(source.unitPriceMinor) : undefined);
      if (unitPriceMinor === undefined) {
        throw AppError.validation('Укажите цену позиции или выберите её из прайса');
      }
      if (unitPriceMinor < 0) throw AppError.validation('Цена не может быть отрицательной');

      const quantity = item.quantity ?? 1;
      if (quantity < 1) throw AppError.validation('Количество должно быть больше нуля');

      const kind = item.kind ?? source?.kind ?? 'damage';
      const panelCode = item.panelCode ?? source?.panelCode ?? null;
      const damageType = item.damageType ?? source?.damageType ?? null;
      const sizeClass = item.sizeClass ?? source?.sizeClass ?? null;
      const title =
        item.title?.trim() ||
        source?.title ||
        defaultItemTitle({ panelCode, damageType, quantity, sizeClass });

      return {
        position: index + 1,
        kind,
        title,
        panelCode,
        damageType,
        sizeClass,
        quantity,
        material: item.material ?? null,
        accessDifficulty: item.accessDifficulty ?? null,
        onEdge: item.onEdge ?? false,
        unitPriceMinor: BigInt(unitPriceMinor),
        // Итог строки считается на сервере: клиент не присылает суммы.
        lineTotalMinor: BigInt(lineTotal(quantity, unitPriceMinor)),
        priceListItemId: item.priceListItemId ?? null,
        comment: item.comment ?? null,
      };
    });

    const totals = calcEstimateTotals(
      prepared.map((item) => ({
        quantity: item.quantity,
        unitPriceMinor: Number(item.unitPriceMinor),
      })),
      { kind: estimate.discountKind, value: estimate.discountValue } as DiscountInput,
    );

    await this.prisma.transaction(async (tx) => {
      await this.estimates.replaceItems(ctx.workspaceId, estimateId, prepared, tx);
      await this.estimates.update(
        ctx.workspaceId,
        estimateId,
        {
          subtotalMinor: BigInt(totals.subtotalMinor),
          discountMinor: BigInt(totals.discountMinor),
          totalMinor: BigInt(totals.totalMinor),
        },
        tx,
      );
    });

    return this.getById(ctx, estimateId);
  }

  // ── Переходы ──────────────────────────────────────────────────────────────

  async send(ctx: WorkspaceContext, estimateId: string): Promise<Estimate> {
    const estimate = await this.getById(ctx, estimateId);
    const order = await this.orderFor(ctx, estimate.orderId);
    this.assertCanWrite(ctx, order);

    if (estimate.status !== 'draft') {
      throw new AppError(
        'invalid_transition',
        `Отправить можно черновик, а смета — «${ESTIMATE_STATUS_LABELS[estimate.status]}»`,
      );
    }
    if (estimate.items.length === 0) {
      throw AppError.validation('В смете нет ни одной позиции');
    }

    return this.prisma.transaction(async (tx) => {
      const sent = await this.estimates.update(
        ctx.workspaceId,
        estimateId,
        { status: 'sent', sentAt: new Date() },
        tx,
      );

      // Заказ переходит на согласование: клиент получил расчёт и думает.
      if (order.status === 'new') {
        await this.orders.update(ctx.workspaceId, order.id, { status: 'pending_approval' }, tx);
        await this.orders.addHistory(
          ctx.workspaceId,
          {
            orderId: order.id,
            fromStatus: order.status,
            toStatus: 'pending_approval',
            changedById: ctx.userId,
            comment: `Смета v${estimate.versionNo} отправлена клиенту`,
          },
          tx,
        );
      }
      return sent;
    });
  }

  async agree(ctx: WorkspaceContext, estimateId: string): Promise<Estimate> {
    const estimate = await this.getById(ctx, estimateId);
    const order = await this.orderFor(ctx, estimate.orderId);
    this.assertCanWrite(ctx, order);

    if (estimate.status === 'agreed') return estimate;
    if (estimate.status !== 'draft' && estimate.status !== 'sent') {
      throw new AppError(
        'invalid_transition',
        `Согласовать можно черновик или отправленную смету, а эта — «${ESTIMATE_STATUS_LABELS[estimate.status]}»`,
      );
    }
    if (estimate.items.length === 0) {
      throw AppError.validation('В смете нет ни одной позиции');
    }

    return this.prisma.transaction(async (tx) => {
      // Предыдущая согласованная версия заменяется в той же транзакции:
      // частичный уникальный индекс не допускает двух согласованных смет.
      const previous = await this.estimates.findAgreedForOrder(ctx.workspaceId, order.id, tx);
      if (previous && previous.id !== estimateId) {
        await this.estimates.update(ctx.workspaceId, previous.id, { status: 'superseded' }, tx);
      }

      const agreed = await this.estimates.update(
        ctx.workspaceId,
        estimateId,
        { status: 'agreed', agreedAt: new Date(), agreedById: ctx.userId },
        tx,
      );

      const total = Number(agreed.totalMinor);
      await this.orders.update(
        ctx.workspaceId,
        order.id,
        {
          agreedEstimateId: agreed.id,
          agreedTotalMinor: agreed.totalMinor,
          paymentStatus: calcPaymentStatus(total, Number(order.paidMinor)),
        },
        tx,
      );

      await this.orders.addHistory(
        ctx.workspaceId,
        {
          orderId: order.id,
          fromStatus: order.status,
          toStatus: order.status,
          changedById: ctx.userId,
          comment: `Смета v${agreed.versionNo} согласована`,
        },
        tx,
      );

      return agreed;
    });
  }

  async reject(
    ctx: WorkspaceContext,
    estimateId: string,
    reason?: string | null,
  ): Promise<Estimate> {
    const estimate = await this.getById(ctx, estimateId);
    const order = await this.orderFor(ctx, estimate.orderId);
    this.assertCanWrite(ctx, order);

    if (estimate.status !== 'sent' && estimate.status !== 'draft') {
      throw new AppError(
        'invalid_transition',
        `Отклонить можно черновик или отправленную смету, а эта — «${ESTIMATE_STATUS_LABELS[estimate.status]}»`,
      );
    }

    return this.estimates.update(ctx.workspaceId, estimateId, {
      status: 'rejected',
      rejectedAt: new Date(),
      rejectReason: reason ?? null,
    });
  }

  // ── Вспомогательное ───────────────────────────────────────────────────────

  private async createDraft(
    tx: Prisma.TransactionClient,
    ctx: WorkspaceContext,
    order: Order,
    source: EstimateWithItems | null,
  ): Promise<Estimate> {
    const versionNo = await this.estimates.nextVersionNo(ctx.workspaceId, order.id, tx);

    const draft = await this.estimates.create(
      ctx.workspaceId,
      {
        orderId: order.id,
        versionNo,
        status: 'draft',
        currency: order.currency,
        discountKind: source?.discountKind ?? 'none',
        discountValue: source?.discountValue ?? 0,
        subtotalMinor: source?.subtotalMinor ?? BigInt(0),
        discountMinor: source?.discountMinor ?? BigInt(0),
        totalMinor: source?.totalMinor ?? BigInt(0),
        noteForClient: source?.noteForClient ?? null,
        internalNote: source?.internalNote ?? null,
        createdById: ctx.userId,
      },
      tx,
    );

    if (source && source.items.length > 0) {
      await this.estimates.replaceItems(
        ctx.workspaceId,
        draft.id,
        source.items.map((item) => ({
          position: item.position,
          kind: item.kind,
          title: item.title,
          panelCode: item.panelCode,
          damageType: item.damageType,
          sizeClass: item.sizeClass,
          quantity: item.quantity,
          material: item.material,
          accessDifficulty: item.accessDifficulty,
          onEdge: item.onEdge,
          unitPriceMinor: item.unitPriceMinor,
          lineTotalMinor: item.lineTotalMinor,
          priceListItemId: item.priceListItemId,
          comment: item.comment,
        })),
        tx,
      );
    }

    return draft;
  }

  private assertEditable(estimate: { status: Estimate['status'] }): void {
    if (!isEstimateEditable(estimate.status)) {
      throw new AppError(
        'estimate_immutable',
        `Смета в статусе «${ESTIMATE_STATUS_LABELS[estimate.status]}» не редактируется. Сделайте новую версию.`,
      );
    }
  }

  private assertDiscount(discount: DiscountInput): void {
    const value = discount.value ?? 0;
    if (value < 0) throw AppError.validation('Скидка не может быть отрицательной');
    if (discount.kind === 'percent' && value > 100) {
      throw AppError.validation('Скидка в процентах не может быть больше 100');
    }
  }

  /** Смета доступна ровно тем, кому доступен её заказ. */
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
    if (ctx.permissions.has('estimates.write_all')) return;
    if (!ctx.permissions.has('estimates.write_own')) {
      throw AppError.forbidden('Составлять сметы в этой мастерской может только владелец');
    }
    if (!ownsRecord({ memberId: ctx.member.id, userId: ctx.userId }, order)) {
      throw AppError.notFound('Заказ не найден');
    }
  }
}
