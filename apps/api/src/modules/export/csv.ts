/**
 * Формирование CSV. Выгрузка открывается в Excel, поэтому:
 * разделитель — точка с запятой (русская локаль), перевод строки CRLF,
 * впереди BOM. Иначе кириллица и числа разъезжаются по столбцам.
 */

export type CsvValue = string | number | boolean | Date | null | undefined;

const SEPARATOR = ';';
const NEWLINE = '\r\n';
export const CSV_BOM = '﻿';

export function escapeCsvValue(value: CsvValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'boolean') return value ? 'да' : 'нет';

  const text = String(value);
  // Формула в ячейке — исполняемый код в Excel: обезвреживаем ведущие символы.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  if (safe.includes(SEPARATOR) || safe.includes('"') || /[\r\n]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

export function csvRow(values: readonly CsvValue[]): string {
  return values.map(escapeCsvValue).join(SEPARATOR);
}

export function buildCsv(headers: readonly string[], rows: readonly CsvValue[][]): string {
  return CSV_BOM + [csvRow(headers), ...rows.map(csvRow)].join(NEWLINE) + NEWLINE;
}

/** Деньги в выгрузке — в основных единицах с двумя знаками: их будут считать в Excel. */
export function minorToMajor(minor: bigint | number | null | undefined): string {
  if (minor === null || minor === undefined) return '';
  const value = typeof minor === 'bigint' ? Number(minor) : minor;
  return (value / 100).toFixed(2).replace('.', ',');
}
