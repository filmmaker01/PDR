/**
 * Время хранится в UTC. Отображение и границы суток — в часовом поясе мастерской.
 * Реализация опирается на Intl, без внешних зависимостей.
 */

export type IanaTimeZone = string;

const partsCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: IanaTimeZone): Intl.DateTimeFormat {
  let f = partsCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    partsCache.set(timeZone, f);
  }
  return f;
}

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function getZonedParts(date: Date, timeZone: IanaTimeZone): ZonedParts {
  const parts = formatter(timeZone).formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes): number => {
    const v = parts.find((p) => p.type === type)?.value ?? '0';
    return Number(v === '24' ? '0' : v);
  };
  return {
    year: pick('year'),
    month: pick('month'),
    day: pick('day'),
    hour: pick('hour'),
    minute: pick('minute'),
    second: pick('second'),
  };
}

/** Смещение зоны относительно UTC в минутах для конкретного момента. */
export function tzOffsetMinutes(date: Date, timeZone: IanaTimeZone): number {
  const p = getZonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return (asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60_000;
}

/**
 * Локальное время мастерской → UTC.
 * `local` в формате `YYYY-MM-DDTHH:mm` или `YYYY-MM-DDTHH:mm:ss` (без зоны).
 */
export function zonedTimeToUtc(local: string, timeZone: IanaTimeZone): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(local.trim());
  if (!m) throw new RangeError(`Invalid local datetime: ${local}`);
  const [, y, mo, d, h, mi, s] = m;
  const naiveUtc = Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(s ?? '0'),
  );
  // Двухпроходная коррекция: покрывает переходы на летнее время.
  let guess = new Date(naiveUtc - tzOffsetMinutes(new Date(naiveUtc), timeZone) * 60_000);
  guess = new Date(naiveUtc - tzOffsetMinutes(guess, timeZone) * 60_000);
  return guess;
}

/** UTC → строка локального времени мастерской `YYYY-MM-DDTHH:mm:ss`. */
export function utcToZonedString(date: Date, timeZone: IanaTimeZone): string {
  const p = getZonedParts(date, timeZone);
  const pad = (n: number, len = 2): string => String(n).padStart(len, '0');
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
}

/** Границы суток `YYYY-MM-DD` в зоне мастерской, выраженные в UTC. */
export function dayRangeInZone(dayIso: string, timeZone: IanaTimeZone): { from: Date; to: Date } {
  const from = zonedTimeToUtc(`${dayIso}T00:00:00`, timeZone);
  const next = new Date(
    Date.UTC(
      Number(dayIso.slice(0, 4)),
      Number(dayIso.slice(5, 7)) - 1,
      Number(dayIso.slice(8, 10)) + 1,
    ),
  );
  const nextIso = next.toISOString().slice(0, 10);
  const to = zonedTimeToUtc(`${nextIso}T00:00:00`, timeZone);
  return { from, to };
}

/** Текущая дата `YYYY-MM-DD` в зоне мастерской. */
export function todayInZone(timeZone: IanaTimeZone, now = new Date()): string {
  const p = getZonedParts(now, timeZone);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
