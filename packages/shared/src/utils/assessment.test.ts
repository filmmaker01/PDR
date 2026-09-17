import { describe, expect, it } from 'vitest';
import {
  ASSESSMENT_MULTIPLIERS,
  calcAssessment,
  findPriceRule,
  sizeClassForDimensions,
  suggestDamagePrice,
  type PriceRule,
} from './assessment';

function rule(overrides: Partial<PriceRule> & { id: string }): PriceRule {
  return {
    kind: 'damage',
    title: 'Позиция',
    panelCode: null,
    damageType: null,
    sizeClass: null,
    unitPriceMinor: 100_000,
    unit: 'per_item',
    isActive: true,
    ...overrides,
  };
}

const PRICE_LIST: PriceRule[] = [
  rule({
    id: 'hood-dent-m',
    title: 'Капот, вмятина M',
    panelCode: 'hood',
    damageType: 'dent',
    sizeClass: 'M',
    unitPriceMinor: 400_000,
  }),
  rule({
    id: 'hood-dent-s',
    title: 'Капот, вмятина S',
    panelCode: 'hood',
    damageType: 'dent',
    sizeClass: 'S',
    unitPriceMinor: 250_000,
  }),
  rule({ id: 'hood-any', title: 'Капот, прочее', panelCode: 'hood', unitPriceMinor: 300_000 }),
  rule({
    id: 'roof-hail',
    title: 'Крыша, град',
    panelCode: 'roof',
    damageType: 'hail',
    unitPriceMinor: 800_000,
  }),
  rule({
    id: 'inactive',
    title: 'Старая цена',
    panelCode: 'hood',
    damageType: 'dent',
    sizeClass: 'M',
    unitPriceMinor: 10,
    isActive: false,
  }),
];

describe('размерный класс по габаритам', () => {
  it('берёт большую сторону', () => {
    expect(sizeClassForDimensions(10, 60)).toBe('L');
  });

  it('раскладывает по сетке S/M/L/XL', () => {
    expect(sizeClassForDimensions(20, 20)).toBe('S');
    expect(sizeClassForDimensions(50, 10)).toBe('M');
    expect(sizeClassForDimensions(100, 100)).toBe('L');
    // 40×40 см из брифа — заведомо XL.
    expect(sizeClassForDimensions(400, 400)).toBe('XL');
  });

  it('без размеров класса нет', () => {
    expect(sizeClassForDimensions(null, undefined)).toBeNull();
    expect(sizeClassForDimensions(0, -5)).toBeNull();
  });
});

describe('подбор позиции прайса', () => {
  it('выбирает самую подробную подходящую позицию', () => {
    const found = findPriceRule(PRICE_LIST, { panelCode: 'hood', damageType: 'dent' }, 'M');
    expect(found?.id).toBe('hood-dent-m');
  });

  it('падает на общую позицию, когда тип повреждения неизвестен', () => {
    const found = findPriceRule(PRICE_LIST, { panelCode: 'hood' }, null);
    expect(found?.id).toBe('hood-any');
  });

  it('не берёт позицию другого элемента кузова', () => {
    expect(findPriceRule(PRICE_LIST, { panelCode: 'door_fl' }, 'M')).toBeNull();
  });

  it('не берёт отключённую позицию', () => {
    const only = [rule({ id: 'off', panelCode: 'hood', isActive: false })];
    expect(findPriceRule(only, { panelCode: 'hood' }, null)).toBeNull();
  });
});

describe('предварительная стоимость повреждения', () => {
  it('считает по прайсу и объясняет расчёт', () => {
    const result = suggestDamagePrice(
      { panelCode: 'hood', damageType: 'dent', widthMm: 30, heightMm: 30 },
      PRICE_LIST,
    );
    expect(result.priceListItemId).toBe('hood-dent-m');
    expect(result.sizeClass).toBe('M');
    expect(result.unitPriceMinor).toBe(400_000);
    expect(result.lineTotalMinor).toBe(400_000);
    expect(result.explanation).toContain('Капот, вмятина M');
  });

  it('применяет надбавки за алюминий, доступ и ребро', () => {
    const result = suggestDamagePrice(
      {
        panelCode: 'hood',
        damageType: 'dent',
        sizeClass: 'M',
        material: 'aluminum',
        accessDifficulty: 'hard',
        onEdge: true,
      },
      PRICE_LIST,
    );
    const expected = Math.round(
      400_000 *
        ASSESSMENT_MULTIPLIERS.material.aluminum *
        ASSESSMENT_MULTIPLIERS.accessDifficulty.hard *
        ASSESSMENT_MULTIPLIERS.onEdge,
    );
    expect(result.unitPriceMinor).toBe(expected);
    expect(result.multipliers.map((m) => m.reason)).toEqual([
      'алюминий',
      'сложный доступ',
      'на ребре',
    ]);
  });

  it('умножает на количество вмятин', () => {
    const result = suggestDamagePrice(
      { panelCode: 'roof', damageType: 'hail', quantity: 12 },
      PRICE_LIST,
    );
    expect(result.quantity).toBe(12);
    expect(result.lineTotalMinor).toBe(800_000 * 12);
  });

  it('не выдумывает цену, когда прайс не покрывает повреждение', () => {
    const result = suggestDamagePrice({ panelCode: 'sill_l' }, PRICE_LIST);
    expect(result.priceListItemId).toBeNull();
    expect(result.unitPriceMinor).toBe(0);
    expect(result.explanation).toContain('вручную');
  });
});

describe('полный расчёт оценки', () => {
  it('складывает строки и помнит предложенную сумму', () => {
    const result = calcAssessment(
      [
        { panelCode: 'hood', damageType: 'dent', sizeClass: 'M' },
        { panelCode: 'roof', damageType: 'hail', quantity: 2 },
      ],
      PRICE_LIST,
    );
    expect(result.suggestedMinor).toBe(400_000 + 1_600_000);
    expect(result.totalMinor).toBe(400_000 + 1_600_000);
    expect(result.lines).toHaveLength(2);
  });

  it('ручная цена перебивает расчёт, но предложение сохраняется', () => {
    const result = calcAssessment(
      [{ panelCode: 'hood', damageType: 'dent', sizeClass: 'M', unitPriceMinor: 150_000 }],
      PRICE_LIST,
    );
    expect(result.lines[0]!.overridden).toBe(true);
    expect(result.lines[0]!.suggestedUnitPriceMinor).toBe(400_000);
    expect(result.lines[0]!.unitPriceMinor).toBe(150_000);
    expect(result.suggestedMinor).toBe(400_000);
    expect(result.totalMinor).toBe(150_000);
  });

  it('совпадение ручной цены с расчётом правкой не считается', () => {
    const result = calcAssessment(
      [{ panelCode: 'hood', damageType: 'dent', sizeClass: 'M', unitPriceMinor: 400_000 }],
      PRICE_LIST,
    );
    expect(result.lines[0]!.overridden).toBe(false);
  });

  it('отрицательная ручная цена обнуляется, а не уходит в минус', () => {
    const result = calcAssessment(
      [{ panelCode: 'hood', damageType: 'dent', sizeClass: 'M', unitPriceMinor: -5_000 }],
      PRICE_LIST,
    );
    expect(result.totalMinor).toBe(0);
  });
});
