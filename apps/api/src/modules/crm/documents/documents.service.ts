import { Injectable } from '@nestjs/common';
import {
  ESTIMATE_ITEM_KIND_LABELS,
  applyPriceCoefficient,
  damageTypeLabel,
  defaultItemTitle,
  panelLabel,
  sizeClassLabel,
} from '@pdr/shared';
import { AppError } from '@/common/errors/app.error';
import { WorkspacesService } from '@/modules/workspaces/workspaces.service';
import type { WorkspaceContext } from '@/modules/workspaces/workspace.types';
import { ORDER_STATUS_LABELS } from '../orders/order-state-machine';
import { AssessmentsRepository } from '../repositories/assessments.repository';
import { DamagesRepository } from '../repositories/damages.repository';
import { EstimatesRepository } from '../repositories/estimates.repository';
import { OrdersRepository } from '../repositories/orders.repository';
import { PdfDocumentBuilder } from './pdf-document';
import {
  ORDER_DOCUMENT_TEMPLATES,
  orderDocumentTemplate,
  type DocumentDamageRow,
  type DocumentWorkRow,
  type OrderDocumentContext,
  type OrderDocumentKind,
} from './order-documents';

/**
 * Документы заказа: акт осмотра, заказ-наряд, акт выполненных работ.
 *
 * Данные берутся из того, что уже введено: клиент, автомобиль, повреждения
 * на схеме, оценка или согласованная смета, оплаты. Второй раз ничего
 * вводить не нужно — иначе документ разошёлся бы с карточкой заказа.
 *
 * Источник сумм — согласованная смета, если она есть: именно её подписал
 * клиент. Пока сметы нет, документ печатается по последней оценке.
 */
@Injectable()
export class DocumentsService {
  constructor(
    private readonly orders: OrdersRepository,
    private readonly damages: DamagesRepository,
    private readonly assessments: AssessmentsRepository,
    private readonly estimates: EstimatesRepository,
  ) {}

  /** Перечень документов заказа для интерфейса. */
  list(): { kind: OrderDocumentKind; title: string; description: string }[] {
    return Object.values(ORDER_DOCUMENT_TEMPLATES).map((template) => ({
      kind: template.kind,
      title: template.title,
      description: template.description,
    }));
  }

  async render(
    ctx: WorkspaceContext,
    orderId: string,
    kind: string,
  ): Promise<{ buffer: Buffer; fileName: string; title: string }> {
    const template = orderDocumentTemplate(kind);
    if (!template) throw AppError.notFound('Документ не найден');

    const data = await this.collect(ctx, orderId);
    const pdf = new PdfDocumentBuilder(template.title, data.currency);
    template.render(pdf, data);

    return {
      buffer: await pdf.finish(),
      fileName: template.fileName(data),
      title: template.title,
    };
  }

  /** Сбор данных документа из карточки заказа. */
  private async collect(ctx: WorkspaceContext, orderId: string): Promise<OrderDocumentContext> {
    const order = await this.orders.findById(ctx.workspaceId, orderId);
    if (!order) throw AppError.notFound('Заказ не найден');

    const [damages, estimates, assessments] = await Promise.all([
      this.damages.listFor(ctx.workspaceId, { orderId }),
      this.estimates.listForOrder(ctx.workspaceId, orderId),
      this.assessments.listFor(ctx.workspaceId, { orderId }),
    ]);
    const agreed = estimates.find((estimate) => estimate.status === 'agreed') ?? null;
    const latest = assessments[0] ?? null;

    const damageRows: DocumentDamageRow[] = damages.map((damage) => ({
      panel: panelLabel(damage.panelCode) ?? damage.panelCode,
      damage: damageTypeLabel(damage.damageType),
      size: sizeClassLabel(damage.sizeClass),
      quantity: damage.quantity,
      onEdge: damage.onEdge,
      comment: damage.comment,
      priceMinor: damage.priceMinor === null ? null : Number(damage.priceMinor),
    }));

    // Смета подписана клиентом — она и есть основание. Оценка идёт в дело,
    // пока сметы нет: без неё заказ-наряд печатался бы без работ и сумм.
    let works: DocumentWorkRow[] = [];
    let source: OrderDocumentContext['source'] = 'none';
    let baseMinor = 0;
    let coefficient = 100;
    let extrasMinor = 0;
    let pdrMinor = 0;
    let discountMinor = 0;
    let totalMinor = 0;

    if (agreed) {
      source = 'estimate';
      works = agreed.items.map((item) => ({
        kind: item.kind,
        title: item.title,
        details:
          [
            item.kind === 'damage' ? null : ESTIMATE_ITEM_KIND_LABELS[item.kind],
            panelLabel(item.panelCode),
            damageTypeLabel(item.damageType),
            sizeClassLabel(item.sizeClass),
            item.onEdge ? 'на ребре' : null,
            item.comment,
          ]
            .filter(Boolean)
            .join(' · ') || null,
        quantity: item.quantity,
        unitPriceMinor: Number(item.unitPriceMinor),
        lineTotalMinor: Number(item.lineTotalMinor),
      }));
      pdrMinor = works
        .filter((work) => work.kind === 'damage')
        .reduce((sum, work) => sum + work.lineTotalMinor, 0);
      extrasMinor = works
        .filter((work) => work.kind !== 'damage')
        .reduce((sum, work) => sum + work.lineTotalMinor, 0);
      discountMinor = Number(agreed.discountMinor);
      totalMinor = Number(agreed.totalMinor);
    } else if (latest) {
      source = 'assessment';
      coefficient = latest.priceCoefficient;
      baseMinor = Number(latest.baseMinor);
      extrasMinor = Number(latest.extrasMinor);
      pdrMinor = applyPriceCoefficient(baseMinor, coefficient);
      totalMinor = Number(latest.totalMinor);
      works = latest.items.map((item) => ({
        kind: item.kind,
        title:
          item.kind === 'damage'
            ? defaultItemTitle({
                panelCode: item.panelCode,
                damageType: item.damageType,
                quantity: item.quantity,
                sizeClass: item.sizeClass,
              })
            : (item.title ?? 'Арматурная работа'),
        details:
          [
            item.kind === 'damage' ? null : ESTIMATE_ITEM_KIND_LABELS[item.kind],
            item.onEdge ? 'на ребре' : null,
            item.comment,
          ]
            .filter(Boolean)
            .join(' · ') || null,
        quantity: item.quantity,
        // Цена PDR-строки печатается с коэффициентом: иначе сумма строк
        // не сходилась бы с итогом документа.
        unitPriceMinor:
          item.kind === 'damage'
            ? applyPriceCoefficient(Number(item.unitPriceMinor), coefficient)
            : Number(item.unitPriceMinor),
        lineTotalMinor:
          item.kind === 'damage'
            ? applyPriceCoefficient(Number(item.lineTotalMinor), coefficient)
            : Number(item.lineTotalMinor),
      }));
      // Оценка без разбора на позиции (мастер назвал сумму) — одна строка:
      // документ без работ выглядел бы как ошибка.
      if (works.length === 0 && totalMinor > 0) {
        works = [
          {
            kind: 'damage',
            title: order.title ?? 'Ремонт по технологии PDR',
            details: latest.explanation,
            quantity: 1,
            unitPriceMinor: totalMinor,
            lineTotalMinor: totalMinor,
          },
        ];
        pdrMinor = totalMinor;
      }
    }

    const paidMinor = Number(order.paidMinor);
    const settings = WorkspacesService.settingsOf(ctx.workspace);

    return {
      requisites: {
        name: settings.document_legal_name?.trim() || ctx.workspace.name,
        lines: [
          ctx.workspace.phone,
          ctx.workspace.address,
          ...(settings.document_requisites?.trim()
            ? settings.document_requisites
                .split('\n')
                .map((line) => line.trim())
                .filter(Boolean)
            : []),
        ].filter((line): line is string => Boolean(line)),
      },
      order: {
        number: order.number,
        title: order.title,
        statusLabel: ORDER_STATUS_LABELS[order.status],
        createdAt: order.createdAt,
        scheduledStartAt: order.scheduledStartAt,
        startedAt: order.startedAt,
        readyAt: order.readyAt,
        deliveredAt: order.deliveredAt,
      },
      client: { name: order.client.name, phone: order.client.phone },
      vehicle: order.vehicle
        ? {
            make: order.vehicle.make,
            model: order.vehicle.model,
            plate: order.vehicle.plate,
            vin: order.vehicle.vin,
            year: order.vehicle.year,
            color: order.vehicle.color,
          }
        : null,
      assignee: order.assignee
        ? (order.assignee.displayName ??
          [order.assignee.user.firstName, order.assignee.user.lastName].filter(Boolean).join(' '))
        : null,
      damages: damageRows,
      works,
      totals: {
        baseMinor,
        coefficient,
        pdrMinor,
        extrasMinor,
        discountMinor,
        totalMinor,
        paidMinor,
        remainingMinor: Math.max(0, totalMinor - paidMinor),
      },
      source,
      currency: order.currency,
      now: new Date(),
    };
  }
}
