import { PdfDocumentBuilder } from './pdf-document';

/**
 * Документы заказа.
 *
 * Каждый документ — шаблон в реестре: название, имя файла и отрисовка.
 * Состав данных общий и собирается один раз, поэтому добавить, скажем, счёт
 * или гарантийный талон — это новая запись в реестре, а не новый модуль.
 */
export const ORDER_DOCUMENT_KINDS = ['inspection_act', 'work_order', 'completion_act'] as const;

export type OrderDocumentKind = (typeof ORDER_DOCUMENT_KINDS)[number];

export interface DocumentWorkRow {
  kind: 'damage' | 'disassembly' | 'extra';
  title: string;
  /** Подпись мелким шрифтом: параметры повреждения, комментарий. */
  details: string | null;
  quantity: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
}

export interface DocumentDamageRow {
  panel: string;
  damage: string | null;
  size: string | null;
  quantity: number;
  onEdge: boolean;
  comment: string | null;
  priceMinor: number | null;
}

export interface OrderDocumentContext {
  /** Реквизиты мастерской: правятся в настройках, а не в коде. */
  requisites: { name: string; lines: string[] };
  order: {
    number: number;
    title: string | null;
    statusLabel: string;
    createdAt: Date;
    scheduledStartAt: Date | null;
    startedAt: Date | null;
    readyAt: Date | null;
    deliveredAt: Date | null;
  };
  client: { name: string; phone: string | null } | null;
  vehicle: {
    make: string;
    model: string;
    plate: string | null;
    vin: string | null;
    year: number | null;
    color: string | null;
  } | null;
  assignee: string | null;
  /** Повреждения на схеме кузова: перечень для акта осмотра. */
  damages: DocumentDamageRow[];
  /** Работы: PDR-ремонт и арматурные работы. */
  works: DocumentWorkRow[];
  totals: {
    /** Базовый расчёт PDR до коэффициента. */
    baseMinor: number;
    coefficient: number;
    pdrMinor: number;
    extrasMinor: number;
    discountMinor: number;
    totalMinor: number;
    paidMinor: number;
    remainingMinor: number;
  };
  /** Откуда взяты работы и суммы: согласованная смета или оценка. */
  source: 'estimate' | 'assessment' | 'none';
  currency: string;
  now: Date;
}

export interface OrderDocumentTemplate {
  kind: OrderDocumentKind;
  title: string;
  /** Что документ подтверждает — подсказка в интерфейсе. */
  description: string;
  fileName: (ctx: OrderDocumentContext) => string;
  render: (pdf: PdfDocumentBuilder, ctx: OrderDocumentContext) => void;
}

function date(value: Date | null | undefined): string | null {
  if (!value) return null;
  return value.toLocaleDateString('ru-RU');
}

function vehicleLine(ctx: OrderDocumentContext): string | null {
  if (!ctx.vehicle) return null;
  return [ctx.vehicle.make, ctx.vehicle.model, ctx.vehicle.year ? String(ctx.vehicle.year) : null]
    .filter(Boolean)
    .join(' ');
}

/** Общая шапка: мастерская, название документа, клиент и автомобиль. */
function head(pdf: PdfDocumentBuilder, ctx: OrderDocumentContext, title: string): void {
  pdf.header(ctx.requisites.name, ctx.requisites.lines);
  pdf.documentTitle(
    `${title} № ${ctx.order.number}`,
    `от ${date(ctx.now)} · заказ от ${date(ctx.order.createdAt)}`,
  );
  pdf.facts([
    { label: 'Клиент', value: ctx.client?.name ?? null },
    { label: 'Телефон', value: ctx.client?.phone ?? null },
    { label: 'Автомобиль', value: vehicleLine(ctx) },
    { label: 'Госномер', value: ctx.vehicle?.plate ?? null },
    { label: 'VIN', value: ctx.vehicle?.vin ?? null },
    { label: 'Цвет', value: ctx.vehicle?.color ?? null },
    { label: 'Работа', value: ctx.order.title },
    { label: 'Мастер', value: ctx.assignee },
  ]);
}

const WORK_COLUMNS = [
  { title: 'Наименование', width: 0.52 },
  { title: 'Кол-во', width: 0.12, align: 'right' as const },
  { title: 'Цена', width: 0.18, align: 'right' as const },
  { title: 'Сумма', width: 0.18, align: 'right' as const },
];

function workRows(pdf: PdfDocumentBuilder, works: DocumentWorkRow[]) {
  return works.map((work) => ({
    cells: [
      work.title,
      String(work.quantity),
      pdf.money(work.unitPriceMinor),
      pdf.money(work.lineTotalMinor),
    ],
    details: work.details,
  }));
}

/** Итоги: база, коэффициент, арматурные работы, скидка. */
function totals(pdf: PdfDocumentBuilder, ctx: OrderDocumentContext): void {
  const { totals: t } = ctx;
  if (t.baseMinor > 0 && t.coefficient !== 100) {
    pdf.totalLine('Ремонт PDR по прайсу', pdf.money(t.baseMinor));
    pdf.totalLine(`Коэффициент ${t.coefficient} %`, pdf.money(t.pdrMinor));
  } else if (t.extrasMinor > 0 && t.pdrMinor > 0) {
    pdf.totalLine('Ремонт PDR', pdf.money(t.pdrMinor));
  }
  if (t.extrasMinor > 0) pdf.totalLine('Арматурные работы', pdf.money(t.extrasMinor));
  if (t.discountMinor > 0) pdf.totalLine('Скидка', `−${pdf.money(t.discountMinor)}`);
  pdf.totalLine('Итого', pdf.money(t.totalMinor), true);
}

const INSPECTION_ACT: OrderDocumentTemplate = {
  kind: 'inspection_act',
  title: 'Акт осмотра автомобиля',
  description: 'Перечень согласованных повреждений и состояние автомобиля на момент приёмки',
  fileName: (ctx) => `akt-osmotra-${ctx.order.number}.pdf`,
  render: (pdf, ctx) => {
    head(pdf, ctx, 'Акт осмотра автомобиля');

    pdf.sectionTitle('Согласованные повреждения');
    pdf.table(
      [
        { title: 'Элемент кузова', width: 0.36 },
        { title: 'Повреждение', width: 0.28 },
        { title: 'Размер', width: 0.16 },
        { title: 'Стоимость', width: 0.2, align: 'right' },
      ],
      ctx.damages.map((damage) => ({
        cells: [
          damage.panel,
          [damage.damage, damage.quantity > 1 ? `${damage.quantity} шт` : null]
            .filter(Boolean)
            .join(', ') || '—',
          damage.size ?? '—',
          damage.priceMinor === null ? '—' : pdf.money(damage.priceMinor),
        ],
        details: [damage.onEdge ? 'на ребре жёсткости' : null, damage.comment]
          .filter(Boolean)
          .join(' · ') || null,
      })),
      { empty: 'Повреждения на схеме кузова не отмечены.' },
    );

    if (ctx.works.some((work) => work.kind !== 'damage')) {
      pdf.sectionTitle('Арматурные работы');
      pdf.table(
        WORK_COLUMNS,
        workRows(
          pdf,
          ctx.works.filter((work) => work.kind !== 'damage'),
        ),
      );
    }

    totals(pdf, ctx);

    pdf.paragraph(
      'Автомобиль осмотрен в присутствии клиента. Перечень повреждений выше согласован сторонами: ' +
        'ремонту подлежат только они. Лакокрасочное покрытие на согласованных элементах целое, ' +
        'если иное не указано в примечаниях.',
    );
    pdf.paragraph(
      'Если при разборке обнаружатся скрытые повреждения, мастер согласует их отдельно до начала работ.',
      { small: true, muted: true },
    );

    pdf.signatures([
      { label: 'Осмотр провёл (мастер)', hint: ctx.assignee ?? undefined },
      { label: 'Перечень согласован (клиент)', hint: ctx.client?.name },
    ]);
  },
};

const WORK_ORDER: OrderDocumentTemplate = {
  kind: 'work_order',
  title: 'Заказ-наряд',
  description: 'Что берём в работу, по какой цене и на какой срок',
  fileName: (ctx) => `zakaz-naryad-${ctx.order.number}.pdf`,
  render: (pdf, ctx) => {
    head(pdf, ctx, 'Заказ-наряд');
    pdf.facts([
      { label: 'Записан на', value: date(ctx.order.scheduledStartAt) },
      { label: 'Состояние заказа', value: ctx.order.statusLabel },
    ]);

    pdf.sectionTitle('Работы');
    pdf.table(WORK_COLUMNS, workRows(pdf, ctx.works), {
      empty: 'Работы ещё не рассчитаны: сделайте оценку или согласуйте смету.',
    });
    totals(pdf, ctx);

    if (ctx.totals.paidMinor > 0) {
      pdf.totalLine('Получено', pdf.money(ctx.totals.paidMinor));
      pdf.totalLine('Остаток', pdf.money(ctx.totals.remainingMinor));
    }

    pdf.paragraph(
      'Клиент поручает мастерской выполнить перечисленные работы по технологии PDR без покраски. ' +
        'Стоимость согласована и изменяется только по письменному согласию сторон.',
    );
    pdf.paragraph(
      ctx.source === 'estimate'
        ? 'Основание: согласованная смета по этому заказу.'
        : 'Основание: оценка ремонта по прайсу мастерской.',
      { small: true, muted: true },
    );

    pdf.signatures([
      { label: 'Принял в работу (мастер)', hint: ctx.assignee ?? undefined },
      { label: 'Согласен с работами и ценой (клиент)', hint: ctx.client?.name },
    ]);
  },
};

const COMPLETION_ACT: OrderDocumentTemplate = {
  kind: 'completion_act',
  title: 'Акт выполненных работ',
  description: 'Что сделано, на какую сумму и что оплачено',
  fileName: (ctx) => `akt-vypolnennyh-rabot-${ctx.order.number}.pdf`,
  render: (pdf, ctx) => {
    head(pdf, ctx, 'Акт выполненных работ');
    pdf.facts([
      { label: 'Работы начаты', value: date(ctx.order.startedAt) },
      { label: 'Работы завершены', value: date(ctx.order.readyAt) },
      { label: 'Автомобиль выдан', value: date(ctx.order.deliveredAt) },
    ]);

    pdf.sectionTitle('Выполненные работы');
    pdf.table(WORK_COLUMNS, workRows(pdf, ctx.works), {
      empty: 'Работы по заказу не зафиксированы.',
    });
    totals(pdf, ctx);
    pdf.totalLine('Оплачено', pdf.money(ctx.totals.paidMinor));
    if (ctx.totals.remainingMinor > 0) {
      pdf.totalLine('К оплате', pdf.money(ctx.totals.remainingMinor), true);
    }

    pdf.paragraph(
      'Работы выполнены в полном объёме и в согласованном перечне. Автомобиль осмотрен клиентом ' +
        'при выдаче, претензий по объёму и качеству работ нет.',
    );

    pdf.signatures([
      { label: 'Работы сдал (мастер)', hint: ctx.assignee ?? undefined },
      { label: 'Работы принял (клиент)', hint: ctx.client?.name },
    ]);
  },
};

export const ORDER_DOCUMENT_TEMPLATES: Record<OrderDocumentKind, OrderDocumentTemplate> = {
  inspection_act: INSPECTION_ACT,
  work_order: WORK_ORDER,
  completion_act: COMPLETION_ACT,
};

export function orderDocumentTemplate(kind: string): OrderDocumentTemplate | null {
  return ORDER_DOCUMENT_TEMPLATES[kind as OrderDocumentKind] ?? null;
}
