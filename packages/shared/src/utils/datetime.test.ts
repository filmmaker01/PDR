import { describe, expect, it } from 'vitest';
import {
  addDays,
  dayRangeInZone,
  isValidTimeZone,
  todayInZone,
  utcToZonedString,
  zonedTimeToUtc,
} from './datetime.js';

describe('zonedTimeToUtc', () => {
  it('converts Moscow local time (UTC+3)', () => {
    expect(zonedTimeToUtc('2026-11-15T10:00', 'Europe/Moscow').toISOString()).toBe(
      '2026-11-15T07:00:00.000Z',
    );
  });
  it('converts Krasnoyarsk local time (UTC+7)', () => {
    expect(zonedTimeToUtc('2026-11-15T10:00', 'Asia/Krasnoyarsk').toISOString()).toBe(
      '2026-11-15T03:00:00.000Z',
    );
  });
  it('handles DST transition in Europe/Berlin', () => {
    // 2026-03-29 02:00 CET → 03:00 CEST; 01:30 is still CET (+1)
    expect(zonedTimeToUtc('2026-03-29T01:30', 'Europe/Berlin').toISOString()).toBe(
      '2026-03-29T00:30:00.000Z',
    );
    // 03:30 is CEST (+2)
    expect(zonedTimeToUtc('2026-03-29T03:30', 'Europe/Berlin').toISOString()).toBe(
      '2026-03-29T01:30:00.000Z',
    );
  });
  it('rejects malformed input', () => {
    expect(() => zonedTimeToUtc('15.11.2026 10:00', 'Europe/Moscow')).toThrow();
  });
});

describe('utcToZonedString', () => {
  it('round-trips', () => {
    const utc = zonedTimeToUtc('2026-11-15T23:30', 'Asia/Krasnoyarsk');
    expect(utcToZonedString(utc, 'Asia/Krasnoyarsk')).toBe('2026-11-15T23:30:00');
  });
});

describe('dayRangeInZone', () => {
  it('covers exactly 24h for a normal day', () => {
    const { from, to } = dayRangeInZone('2026-11-15', 'Asia/Krasnoyarsk');
    expect(from.toISOString()).toBe('2026-11-14T17:00:00.000Z');
    expect(to.toISOString()).toBe('2026-11-15T17:00:00.000Z');
  });
  it('an appointment at 23:30 local belongs to that local day', () => {
    const { from, to } = dayRangeInZone('2026-11-15', 'Europe/Moscow');
    const appt = zonedTimeToUtc('2026-11-15T23:30', 'Europe/Moscow');
    expect(appt >= from && appt < to).toBe(true);
  });
});

describe('todayInZone', () => {
  it('uses workspace zone, not server zone', () => {
    // 2026-11-15T20:00Z is already 2026-11-16 in Krasnoyarsk (UTC+7)
    expect(todayInZone('Asia/Krasnoyarsk', new Date('2026-11-15T20:00:00Z'))).toBe('2026-11-16');
    expect(todayInZone('Europe/Moscow', new Date('2026-11-15T20:00:00Z'))).toBe('2026-11-15');
  });
});

describe('addDays / isValidTimeZone', () => {
  it('adds days', () => {
    expect(addDays(new Date('2026-01-01T00:00:00Z'), 30).toISOString()).toBe(
      '2026-01-31T00:00:00.000Z',
    );
  });
  it('validates tz', () => {
    expect(isValidTimeZone('Europe/Moscow')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
  });
});
