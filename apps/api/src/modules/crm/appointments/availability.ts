/**
 * Расчёт свободных слотов. Работает с абсолютным временем (epoch ms),
 * поэтому переход на летнее время и часовой пояс мастерской учитываются
 * там, где границы рабочего дня переводятся в UTC, а не здесь.
 */

export interface TimeRange {
  start: number;
  end: number;
}

export function rangesOverlap(a: TimeRange, b: TimeRange): boolean {
  return a.start < b.end && b.start < a.end;
}

/** Объединение пересекающихся и соприкасающихся интервалов. */
export function mergeRanges(ranges: TimeRange[]): TimeRange[] {
  const sorted = [...ranges].filter((r) => r.end > r.start).sort((a, b) => a.start - b.start);
  const merged: TimeRange[] = [];
  for (const range of sorted) {
    const last = merged.at(-1);
    if (last && range.start <= last.end) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

/** Часть рабочего интервала, не занятая записями. */
export function subtractRanges(base: TimeRange, busy: TimeRange[]): TimeRange[] {
  const free: TimeRange[] = [];
  let cursor = base.start;
  for (const range of mergeRanges(busy)) {
    if (range.end <= base.start || range.start >= base.end) continue;
    if (range.start > cursor) free.push({ start: cursor, end: Math.min(range.start, base.end) });
    cursor = Math.max(cursor, range.end);
    if (cursor >= base.end) break;
  }
  if (cursor < base.end) free.push({ start: cursor, end: base.end });
  return free.filter((r) => r.end > r.start);
}

export interface SlotOptions {
  durationMs: number;
  stepMs: number;
  /** Слоты раньше этого момента не предлагаются (прошедшее время сегодня). */
  notBefore?: number;
}

/**
 * Начала свободных слотов внутри рабочего дня.
 * Слоты выравниваются по сетке шага от начала рабочего дня.
 */
export function availableSlots(
  work: TimeRange,
  busy: TimeRange[],
  options: SlotOptions,
): TimeRange[] {
  const { durationMs, stepMs, notBefore } = options;
  if (durationMs <= 0 || stepMs <= 0) return [];

  const slots: TimeRange[] = [];
  for (const free of subtractRanges(work, busy)) {
    // Выравнивание по сетке от начала рабочего дня, чтобы слоты выглядели
    // как 09:00, 09:30, а не как «через 7 минут после предыдущей записи».
    const offset = Math.ceil((free.start - work.start) / stepMs) * stepMs;
    for (let start = work.start + offset; start + durationMs <= free.end; start += stepMs) {
      if (start < free.start) continue;
      if (notBefore !== undefined && start < notBefore) continue;
      slots.push({ start, end: start + durationMs });
    }
  }
  return slots;
}

/** `HH:mm` → минуты от начала суток. */
export function parseClock(value: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) throw new RangeError(`Invalid time: ${value}`);
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 23 || minutes > 59) throw new RangeError(`Invalid time: ${value}`);
  return hours * 60 + minutes;
}
