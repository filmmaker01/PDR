import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import {
  ESTIMATE_ITEM_KIND_LABELS,
  formatMinor,
  panelLabel,
  damageTypeLabel,
  sizeClassLabel,
} from '@pdr/shared';
import { resolvePdfFonts } from '../documents/pdf-document';
import type { EstimateWithItems } from '../repositories/estimates.repository';

export interface EstimatePdfContext {
  workspace: { name: string; phone: string | null; address: string | null };
  order: { number: number; title: string | null };
  client: { name: string; phone: string | null } | null;
  vehicle: { make: string; model: string; plate: string | null; year: number | null } | null;
}

@Injectable()
export class EstimatePdfService {
  /** Печатная форма сметы одним PDF-файлом. */
  async render(estimate: EstimateWithItems, ctx: EstimatePdfContext): Promise<Buffer> {
    // Шрифты общие с документами заказа: подстановка кириллического TrueType
    // живёт в одном месте, иначе смета и акты расходились бы по оформлению.
    const fonts = resolvePdfFonts();

    const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: 'Смета' } });
    doc.registerFont('regular', fonts.regular);
    doc.registerFont('bold', fonts.bold);

    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    const done = new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    const currency = estimate.currency;
    const money = (value: bigint | number): string => formatMinor(Number(value), currency);

    doc.font('bold').fontSize(16).text(ctx.workspace.name);
    doc.font('regular').fontSize(9).fillColor('#555');
    const contacts = [ctx.workspace.phone, ctx.workspace.address].filter(Boolean).join(' · ');
    if (contacts) doc.text(contacts);
    doc.fillColor('#000').moveDown(1);

    doc
      .font('bold')
      .fontSize(13)
      .text(`Смета к заказу №${ctx.order.number} · версия ${estimate.versionNo}`);
    doc
      .font('regular')
      .fontSize(9)
      .fillColor('#555')
      .text(`от ${estimate.createdAt.toLocaleDateString('ru-RU')}`);
    doc.fillColor('#000').moveDown(0.8);

    const info: string[] = [];
    if (ctx.client) {
      info.push(`Клиент: ${ctx.client.name}${ctx.client.phone ? `, ${ctx.client.phone}` : ''}`);
    }
    if (ctx.vehicle) {
      const vehicle = [
        `${ctx.vehicle.make} ${ctx.vehicle.model}`,
        ctx.vehicle.year ? String(ctx.vehicle.year) : null,
        ctx.vehicle.plate,
      ]
        .filter(Boolean)
        .join(', ');
      info.push(`Автомобиль: ${vehicle}`);
    }
    if (ctx.order.title) info.push(`Работа: ${ctx.order.title}`);
    if (info.length > 0) {
      doc.fontSize(10).text(info.join('\n'));
      doc.moveDown(0.8);
    }

    // Таблица позиций
    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const columns = {
      no: left,
      title: left + 22,
      qty: right - 170,
      price: right - 120,
      sum: right - 60,
    };

    const header = (): void => {
      doc.font('bold').fontSize(9);
      doc.text('№', columns.no, doc.y, { continued: false, lineBreak: false });
      const y = doc.y;
      doc.text('Наименование', columns.title, y, { lineBreak: false });
      doc.text('Кол-во', columns.qty, y, { width: 45, align: 'right', lineBreak: false });
      doc.text('Цена', columns.price, y, { width: 55, align: 'right', lineBreak: false });
      doc.text('Сумма', columns.sum, y, { width: 60, align: 'right' });
      doc.moveDown(0.3);
      doc.moveTo(left, doc.y).lineTo(right, doc.y).strokeColor('#ccc').stroke();
      doc.moveDown(0.4);
      doc.font('regular');
    };

    header();

    estimate.items.forEach((item, index) => {
      if (doc.y > doc.page.height - 140) {
        doc.addPage();
        header();
      }
      const details = [
        ESTIMATE_ITEM_KIND_LABELS[item.kind] ?? item.kind,
        panelLabel(item.panelCode),
        damageTypeLabel(item.damageType),
        sizeClassLabel(item.sizeClass),
        item.onEdge ? 'на ребре' : null,
        item.comment,
      ]
        .filter(Boolean)
        .join(' · ');

      const y = doc.y;
      doc.fontSize(10).text(String(index + 1), columns.no, y, { width: 20, lineBreak: false });
      doc.text(item.title, columns.title, y, { width: columns.qty - columns.title - 10 });
      const titleBottom = doc.y;
      doc.fontSize(10);
      doc.text(String(item.quantity), columns.qty, y, {
        width: 45,
        align: 'right',
        lineBreak: false,
      });
      doc.text(money(item.unitPriceMinor), columns.price, y, {
        width: 55,
        align: 'right',
        lineBreak: false,
      });
      doc.text(money(item.lineTotalMinor), columns.sum, y, { width: 60, align: 'right' });
      doc.y = Math.max(titleBottom, doc.y);

      if (details) {
        doc
          .fontSize(8)
          .fillColor('#666')
          .text(details, columns.title, doc.y, { width: columns.qty - columns.title - 10 });
        doc.fillColor('#000');
      }
      doc.moveDown(0.4);
    });

    doc.moveDown(0.5);
    doc.moveTo(left, doc.y).lineTo(right, doc.y).strokeColor('#ccc').stroke();
    doc.moveDown(0.5);

    const totalLine = (label: string, value: string, isBold = false): void => {
      const y = doc.y;
      doc.font(isBold ? 'bold' : 'regular').fontSize(isBold ? 12 : 10);
      doc.text(label, columns.qty - 60, y, { width: 170, align: 'right', lineBreak: false });
      doc.text(value, columns.sum, y, { width: 60, align: 'right' });
      doc.moveDown(0.2);
    };

    totalLine('Сумма работ', money(estimate.subtotalMinor));
    if (Number(estimate.discountMinor) > 0) {
      const label =
        estimate.discountKind === 'percent' ? `Скидка ${estimate.discountValue}%` : 'Скидка';
      totalLine(label, `−${money(estimate.discountMinor)}`);
    }
    totalLine('Итого', money(estimate.totalMinor), true);

    if (estimate.noteForClient) {
      doc
        .moveDown(1)
        .font('regular')
        .fontSize(10)
        .text(estimate.noteForClient, left, doc.y, {
          width: right - left,
        });
    }

    doc
      .moveDown(1.5)
      .fontSize(8)
      .fillColor('#777')
      .text(
        'Смета составлена по результатам осмотра. Итоговая стоимость может измениться, если при разборке обнаружатся скрытые повреждения — в этом случае мастер согласует новую версию сметы.',
        left,
        doc.y,
        { width: right - left },
      );

    doc.end();
    return done;
  }
}
