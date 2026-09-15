import { describe, expect, it } from 'vitest';
import { cronMatches, minuteKey } from './cron-match';

/** Момент UTC из читаемой записи. */
const at = (iso: string): Date => new Date(`${iso}Z`);

describe('cronMatches', () => {
  it('«каждые 5 минут» срабатывает на кратных пяти', () => {
    expect(cronMatches('*/5 * * * *', at('2026-09-15T10:00'))).toBe(true);
    expect(cronMatches('*/5 * * * *', at('2026-09-15T10:05'))).toBe(true);
    expect(cronMatches('*/5 * * * *', at('2026-09-15T10:55'))).toBe(true);
    expect(cronMatches('*/5 * * * *', at('2026-09-15T10:03'))).toBe(false);
    expect(cronMatches('*/5 * * * *', at('2026-09-15T10:59'))).toBe(false);
  });

  it('«каждые 10 минут» срабатывает на кратных десяти', () => {
    expect(cronMatches('*/10 * * * *', at('2026-09-15T10:00'))).toBe(true);
    expect(cronMatches('*/10 * * * *', at('2026-09-15T10:10'))).toBe(true);
    expect(cronMatches('*/10 * * * *', at('2026-09-15T10:05'))).toBe(false);
  });

  it('ежечасная задача срабатывает только в свою минуту', () => {
    expect(cronMatches('5 * * * *', at('2026-09-15T10:05'))).toBe(true);
    expect(cronMatches('5 * * * *', at('2026-09-15T23:05'))).toBe(true);
    expect(cronMatches('5 * * * *', at('2026-09-15T10:06'))).toBe(false);
    expect(cronMatches('10 * * * *', at('2026-09-15T10:10'))).toBe(true);
    expect(cronMatches('10 * * * *', at('2026-09-15T10:05'))).toBe(false);
  });

  it('ежедневная задача срабатывает только в свой час и минуту', () => {
    expect(cronMatches('30 3 * * *', at('2026-09-15T03:30'))).toBe(true);
    expect(cronMatches('30 3 * * *', at('2026-09-15T04:30'))).toBe(false);
    expect(cronMatches('30 3 * * *', at('2026-09-15T03:31'))).toBe(false);
    expect(cronMatches('0 6 * * *', at('2026-09-15T06:00'))).toBe(true);
    expect(cronMatches('0 6 * * *', at('2026-09-15T06:01'))).toBe(false);
  });

  it('все расписания обработчиков разбираются', () => {
    // Те же выражения, что заданы в обработчиках: ошибка в разборе означала бы
    // молча пропущенное расписание.
    const used = [
      '5 * * * *',
      '30 3 * * *',
      '15 3 * * *',
      '0 6 * * *',
      '*/5 * * * *',
      '20 4 * * *',
      '45 3 * * *',
      '*/10 * * * *',
      '10 * * * *',
    ];

    for (const expr of used) {
      // За сутки каждое из этих расписаний обязано сработать хотя бы раз.
      const hits = [...Array(24 * 60)].filter((_, i) =>
        cronMatches(expr, new Date(Date.UTC(2026, 8, 15, 0, i))),
      ).length;
      expect(hits, expr).toBeGreaterThan(0);
    }
  });

  it('считает срабатывания за сутки', () => {
    const perDay = (expr: string): number =>
      [...Array(24 * 60)].filter((_, i) => cronMatches(expr, new Date(Date.UTC(2026, 8, 15, 0, i))))
        .length;

    expect(perDay('*/5 * * * *')).toBe(288);
    expect(perDay('*/10 * * * *')).toBe(144);
    expect(perDay('5 * * * *')).toBe(24);
    expect(perDay('30 3 * * *')).toBe(1);
  });

  it('поддерживает списки, диапазоны и день недели', () => {
    expect(cronMatches('0,30 * * * *', at('2026-09-15T10:30'))).toBe(true);
    expect(cronMatches('0,30 * * * *', at('2026-09-15T10:15'))).toBe(false);
    expect(cronMatches('0 9-17 * * *', at('2026-09-15T09:00'))).toBe(true);
    expect(cronMatches('0 9-17 * * *', at('2026-09-15T18:00'))).toBe(false);
    // 2026-09-15 — вторник.
    expect(cronMatches('0 0 * * 2', at('2026-09-15T00:00'))).toBe(true);
    expect(cronMatches('0 0 * * 3', at('2026-09-15T00:00'))).toBe(false);
  });

  it('некорректное выражение не срабатывает', () => {
    expect(cronMatches('', at('2026-09-15T10:00'))).toBe(false);
    expect(cronMatches('* * * *', at('2026-09-15T10:00'))).toBe(false);
    expect(cronMatches('* * * * * *', at('2026-09-15T10:00'))).toBe(false);
    expect(cronMatches('99 * * * *', at('2026-09-15T10:00'))).toBe(false);
    expect(cronMatches('abc * * * *', at('2026-09-15T10:00'))).toBe(false);
    expect(cronMatches('*/0 * * * *', at('2026-09-15T10:00'))).toBe(false);
  });
});

describe('minuteKey', () => {
  it('одинаков внутри минуты и различается между минутами', () => {
    expect(minuteKey(new Date('2026-09-15T10:05:00Z'))).toBe(
      minuteKey(new Date('2026-09-15T10:05:59Z')),
    );
    expect(minuteKey(new Date('2026-09-15T10:05:00Z'))).not.toBe(
      minuteKey(new Date('2026-09-15T10:06:00Z')),
    );
  });
});
