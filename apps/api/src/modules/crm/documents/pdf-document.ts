import { existsSync } from 'node:fs';
import { Logger } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { formatMinor } from '@pdr/shared';
import { AppError } from '@/common/errors/app.error';

/**
 * Кириллица во встроенных шрифтах PDF не поддерживается, поэтому подставляем
 * системный TrueType. Путь задаётся переменной окружения, в образе API стоит
 * пакет fonts-dejavu-core.
 */
const FONT_CANDIDATES = [
  process.env.PDF_FONT_PATH,
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
  '/usr/share/fonts/truetype/freefont/FreeSans.ttf',
].filter((path): path is string => Boolean(path));

const BOLD_CANDIDATES = [
  process.env.PDF_FONT_BOLD_PATH,
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
  '/usr/share/fonts/truetype/freefont/FreeSansBold.ttf',
].filter((path): path is string => Boolean(path));

const logger = new Logger('PdfDocument');

function resolveFont(candidates: string[]): string {
  const found = candidates.find((path) => existsSync(path));
  if (!found) {
    logger.error({ candidates }, 'Не найден шрифт для печати документа');
    throw new AppError(
      'service_unavailable',
      'На сервере не установлен шрифт для печати документов. Сообщите администратору.',
    );
  }
  return found;
}

/** Шрифты для печати: проверяются один раз при старте отрисовки. */
export function resolvePdfFonts(): { regular: string; bold: string } {
  return { regular: resolveFont(FONT_CANDIDATES), bold: resolveFont(BOLD_CANDIDATES) };
}

export interface TableColumn {
  title: string;
  /** Доля ширины таблицы, 0–1. Сумма долей должна давать 1. */
  width: number;
  align?: 'left' | 'right';
}

export interface TableRow {
  cells: string[];
  /** Мелкая подпись под первой колонкой: параметры повреждения, комментарий. */
  details?: string | null;
}

/**
 * Обёртка над PDFKit: шапка, блоки «поле — значение», таблица, итоги, подписи.
 *
 * Документы мастерской различаются составом, а не оформлением, поэтому вся
 * вёрстка живёт здесь: поменять внешний вид или реквизиты потом — это правка
 * одного места, а не трёх шаблонов.
 */
export class PdfDocumentBuilder {
  readonly doc: PDFKit.PDFDocument;
  private readonly chunks: Buffer[] = [];
  private readonly done: Promise<Buffer>;

  constructor(
    title: string,
    private readonly currency: string,
  ) {
    const fonts = resolvePdfFonts();
    this.doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: title } });
    this.doc.registerFont('regular', fonts.regular);
    this.doc.registerFont('bold', fonts.bold);
    this.doc.on('data', (chunk: Buffer) => this.chunks.push(chunk));
    this.done = new Promise<Buffer>((resolve, reject) => {
      this.doc.on('end', () => resolve(Buffer.concat(this.chunks)));
      this.doc.on('error', reject);
    });
  }

  get left(): number {
    return this.doc.page.margins.left;
  }

  get right(): number {
    return this.doc.page.width - this.doc.page.margins.right;
  }

  get width(): number {
    return this.right - this.left;
  }

  money(value: bigint | number): string {
    return formatMinor(Number(value), this.currency);
  }

  /** Шапка: мастерская и её реквизиты. */
  header(name: string, requisites: string[]): this {
    this.doc.font('bold').fontSize(16).text(name, this.left, this.doc.y);
    const lines = requisites.filter(Boolean);
    if (lines.length > 0) {
      this.doc.font('regular').fontSize(9).fillColor('#555').text(lines.join(' · '));
      this.doc.fillColor('#000');
    }
    this.doc.moveDown(1);
    return this;
  }

  /** Название документа и дата. */
  documentTitle(title: string, subtitle?: string | null): this {
    this.doc.font('bold').fontSize(13).text(title, this.left, this.doc.y);
    if (subtitle) {
      this.doc.font('regular').fontSize(9).fillColor('#555').text(subtitle);
      this.doc.fillColor('#000');
    }
    this.doc.moveDown(0.8);
    return this;
  }

  /** Блок «поле — значение»: клиент, автомобиль, даты. */
  facts(rows: { label: string; value: string | null }[]): this {
    const shown = rows.filter((row) => row.value);
    if (shown.length === 0) return this;
    this.doc.font('regular').fontSize(10);
    for (const row of shown) {
      this.doc.text(`${row.label}: ${row.value}`, this.left, this.doc.y, { width: this.width });
    }
    this.doc.moveDown(0.8);
    return this;
  }

  sectionTitle(title: string): this {
    this.ensureSpace(60);
    this.doc.font('bold').fontSize(11).text(title, this.left, this.doc.y);
    this.doc.font('regular').moveDown(0.3);
    return this;
  }

  paragraph(text: string, options: { small?: boolean; muted?: boolean } = {}): this {
    this.ensureSpace(50);
    this.doc
      .font('regular')
      .fontSize(options.small ? 8 : 10)
      .fillColor(options.muted ? '#666' : '#000')
      .text(text, this.left, this.doc.y, { width: this.width });
    this.doc.fillColor('#000').moveDown(0.5);
    return this;
  }

  /** Таблица с нумерацией строк. Переносится на новую страницу вместе с шапкой. */
  table(columns: TableColumn[], rows: TableRow[], options: { empty?: string } = {}): this {
    if (rows.length === 0) {
      if (options.empty) this.paragraph(options.empty, { muted: true });
      return this;
    }

    const numberWidth = 22;
    const tableWidth = this.width - numberWidth;
    const offsets: number[] = [];
    let cursor = this.left + numberWidth;
    for (const column of columns) {
      offsets.push(cursor);
      cursor += column.width * tableWidth;
    }
    const widthOf = (index: number): number => columns[index]!.width * tableWidth - 6;

    const head = (): void => {
      this.doc.font('bold').fontSize(9);
      const y = this.doc.y;
      this.doc.text('№', this.left, y, { width: numberWidth, lineBreak: false });
      columns.forEach((column, index) => {
        const last = index === columns.length - 1;
        this.doc.text(column.title, offsets[index]!, y, {
          width: widthOf(index),
          align: column.align ?? 'left',
          lineBreak: last,
        });
      });
      this.doc.moveDown(0.3);
      this.doc.moveTo(this.left, this.doc.y).lineTo(this.right, this.doc.y).strokeColor('#ccc').stroke();
      this.doc.moveDown(0.4);
      this.doc.font('regular');
    };

    head();

    rows.forEach((row, index) => {
      if (this.doc.y > this.doc.page.height - 160) {
        this.doc.addPage();
        head();
      }
      const y = this.doc.y;
      this.doc.fontSize(10);
      this.doc.text(String(index + 1), this.left, y, { width: numberWidth, lineBreak: false });

      let bottom = y;
      row.cells.forEach((cell, cellIndex) => {
        const last = cellIndex === row.cells.length - 1;
        this.doc.text(cell, offsets[cellIndex]!, y, {
          width: widthOf(cellIndex),
          align: columns[cellIndex]?.align ?? 'left',
          lineBreak: last,
        });
        if (last) bottom = Math.max(bottom, this.doc.y);
      });
      this.doc.y = bottom;

      if (row.details) {
        this.doc
          .fontSize(8)
          .fillColor('#666')
          .text(row.details, offsets[0]!, this.doc.y, { width: this.width - numberWidth });
        this.doc.fillColor('#000');
      }
      this.doc.moveDown(0.4);
    });

    this.doc.moveDown(0.2);
    this.doc.moveTo(this.left, this.doc.y).lineTo(this.right, this.doc.y).strokeColor('#ccc').stroke();
    this.doc.moveDown(0.5);
    return this;
  }

  /** Строка итога: подпись справа, сумма в крайней колонке. */
  totalLine(label: string, value: string, strong = false): this {
    const y = this.doc.y;
    this.doc.font(strong ? 'bold' : 'regular').fontSize(strong ? 12 : 10);
    this.doc.text(label, this.left, y, { width: this.width - 90, align: 'right', lineBreak: false });
    this.doc.text(value, this.right - 85, y, { width: 85, align: 'right' });
    this.doc.moveDown(0.2);
    this.doc.font('regular');
    return this;
  }

  /** Подписи сторон: без них документ не имеет силы на месте. */
  signatures(rows: { label: string; hint?: string }[]): this {
    this.ensureSpace(40 + rows.length * 46);
    this.doc.moveDown(1);
    for (const row of rows) {
      const y = this.doc.y;
      this.doc.font('regular').fontSize(10).text(row.label, this.left, y, { lineBreak: false });
      const lineY = y + 12;
      this.doc
        .moveTo(this.left + 200, lineY)
        .lineTo(this.right, lineY)
        .strokeColor('#666')
        .stroke();
      this.doc.y = lineY + 4;
      if (row.hint) {
        this.doc.fontSize(8).fillColor('#777').text(row.hint, this.left + 200, this.doc.y);
        this.doc.fillColor('#000');
      }
      this.doc.moveDown(1);
    }
    return this;
  }

  /** Достаточно ли места на странице: иначе блок разрывается пополам. */
  ensureSpace(height: number): void {
    if (this.doc.y + height > this.doc.page.height - this.doc.page.margins.bottom) {
      this.doc.addPage();
    }
  }

  async finish(): Promise<Buffer> {
    this.doc.end();
    return this.done;
  }
}
