import { describe, expect, it } from 'vitest';
import {
  availableSlots,
  mergeRanges,
  parseClock,
  rangesOverlap,
  subtractRanges,
} from './availability';

const MIN = 60_000;
const at = (minutes: number): number => minutes * MIN;

describe('rangesOverlap', () => {
  it('соприкасающиеся интервалы не пересекаются', () => {
    expect(rangesOverlap({ start: 0, end: at(60) }, { start: at(60), end: at(120) })).toBe(false);
  });

  it('вложенный интервал пересекается', () => {
    expect(rangesOverlap({ start: 0, end: at(120) }, { start: at(30), end: at(60) })).toBe(true);
  });

  it('частичное наложение считается пересечением', () => {
    expect(rangesOverlap({ start: 0, end: at(60) }, { start: at(59), end: at(120) })).toBe(true);
  });
});

describe('mergeRanges', () => {
  it('склеивает пересекающиеся и соприкасающиеся', () => {
    const merged = mergeRanges([
      { start: at(60), end: at(120) },
      { start: at(110), end: at(150) },
      { start: at(150), end: at(180) },
      { start: at(300), end: at(330) },
    ]);
    expect(merged).toEqual([
      { start: at(60), end: at(180) },
      { start: at(300), end: at(330) },
    ]);
  });

  it('отбрасывает пустые интервалы', () => {
    expect(mergeRanges([{ start: at(60), end: at(60) }])).toEqual([]);
  });
});

describe('subtractRanges', () => {
  const work = { start: at(540), end: at(1200) }; // 09:00–20:00

  it('без записей весь день свободен', () => {
    expect(subtractRanges(work, [])).toEqual([work]);
  });

  it('вырезает занятое время', () => {
    expect(subtractRanges(work, [{ start: at(600), end: at(660) }])).toEqual([
      { start: at(540), end: at(600) },
      { start: at(660), end: at(1200) },
    ]);
  });

  it('игнорирует записи вне рабочего дня', () => {
    expect(subtractRanges(work, [{ start: at(0), end: at(300) }])).toEqual([work]);
  });

  it('обрезает запись, выходящую за границы дня', () => {
    expect(subtractRanges(work, [{ start: at(500), end: at(600) }])).toEqual([
      { start: at(600), end: at(1200) },
    ]);
  });

  it('день, занятый целиком, не даёт свободных интервалов', () => {
    expect(subtractRanges(work, [{ start: at(400), end: at(1300) }])).toEqual([]);
  });
});

describe('availableSlots', () => {
  const work = { start: at(540), end: at(720) }; // 09:00–12:00

  it('нарезает свободный день по шагу', () => {
    const slots = availableSlots(work, [], { durationMs: 60 * MIN, stepMs: 60 * MIN });
    expect(slots.map((s) => s.start)).toEqual([at(540), at(600), at(660)]);
  });

  it('не предлагает слот, который не помещается целиком', () => {
    const slots = availableSlots(work, [{ start: at(600), end: at(630) }], {
      durationMs: 60 * MIN,
      stepMs: 30 * MIN,
    });
    expect(slots.map((s) => s.start)).toEqual([at(540), at(630), at(660)]);
  });

  it('выравнивает слоты по сетке от начала дня', () => {
    // Запись до 09:50 — следующий слот начинается в 10:00, а не в 09:50.
    const slots = availableSlots(work, [{ start: at(540), end: at(590) }], {
      durationMs: 30 * MIN,
      stepMs: 30 * MIN,
    });
    expect(slots[0]?.start).toBe(at(600));
  });

  it('не предлагает прошедшее время', () => {
    const slots = availableSlots(work, [], {
      durationMs: 60 * MIN,
      stepMs: 60 * MIN,
      notBefore: at(601),
    });
    expect(slots.map((s) => s.start)).toEqual([at(660)]);
  });

  it('нулевая длительность не даёт слотов', () => {
    expect(availableSlots(work, [], { durationMs: 0, stepMs: 60 * MIN })).toEqual([]);
  });
});

describe('parseClock', () => {
  it('разбирает время суток', () => {
    expect(parseClock('09:30')).toBe(570);
    expect(parseClock('9:05')).toBe(545);
    expect(parseClock('00:00')).toBe(0);
  });

  it('отвергает недопустимое время', () => {
    expect(() => parseClock('24:00')).toThrow();
    expect(() => parseClock('09:60')).toThrow();
    expect(() => parseClock('девять')).toThrow();
  });
});
