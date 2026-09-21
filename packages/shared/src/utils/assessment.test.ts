import { describe, expect, it } from 'vitest';
import {
  ASSESSMENT_MULTIPLIERS,
  PRICE_COEFFICIENT_MAX,
  PRICE_COEFFICIENT_MIN,
  calcAssessment,
  findPriceRule,
  normalizePriceCoefficient,
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

const ARM_PRICE_LIST: PriceRule[] = [
  ...PRICE_LIST,
  rule({
    id: 'door-dent-m',
    title: 'Дверь, вмятина M',
    panelCode: 'door_fl',
    damageType: 'dent',
    sizeClass: 'M',
    unitPriceMinor: 800_000,
  }),
  rule({
    id: 'arm-door',
    kind: 'disassembly',
    title: 'Разбор двери',
    unitPriceMinor: 200_000,
  }),
];

describe('размерный класс по габаритам', () => {
  it('берёт большую сторону', () => {
    expect(sizeClassForDimensions(10, 60)).toBe('L');
  });

  it('раскладывает мелкие вмятины по сетке S/M/L/XL', () => {
    expect(sizeClassForDimensions(20, 20)).toBe('S');
    expect(sizeClassForDimensions(50, 10)).toBe('M');
    expect(sizeClassForDimensions(100, 100)).toBe('L');
    expect(sizeClassForDimensions(200, 200)).toBe('XL');
  });

  it('различает крупные зоны: 40×40, 40×60 и 60×60 — разная работа', () => {
    expect(sizeClassForDimensions(400, 400)).toBe('40x40');
    expect(sizeClassForDimensions(400, 600)).toBe('40x60');
    expect(sizeClassForDimensions(600, 600)).toBe('60x60');
    expect(sizeClassForDimensions(200, 400)).toBe('20x40');
    expect(sizeClassForDimensions(2_000, 2_000)).toBe('100x100');
  });

  it('одна сторона — повреждение считается круглым', () => {
    expect(sizeClassForDimensions(400, null)).toBe('40x40');
    expect(sizeClassForDimensions(null, 60)).toBe('L');
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

describe('коэффициент стоимости', () => {
  it('применяется к базовому расчёту и не меняет сам расчёт', () => {
    const result = calcAssessment(
      [{ panelCode: 'hood', damageType: 'dent', sizeClass: 'M' }],
      PRICE_LIST,
      { coefficientPercent: 120 },
    );
    expect(result.pdrBaseMinor).toBe(400_000);
    expect(result.coefficientPercent).toBe(120);
    expect(result.pdrMinor).toBe(480_000);
    expect(result.totalMinor).toBe(480_000);
    expect(result.formula).toContain('× 1.20');
  });

  it('округляется к шагу 5 % и не выходит за границы', () => {
    expect(normalizePriceCoefficient(123)).toBe(125);
    expect(normalizePriceCoefficient(0)).toBe(PRICE_COEFFICIENT_MIN);
    expect(normalizePriceCoefficient(1000)).toBe(PRICE_COEFFICIENT_MAX);
    expect(normalizePriceCoefficient(null)).toBe(100);
  });

  it('при 100 % формула не врёт про умножение', () => {
    const result = calcAssessment([{ panelCode: 'hood', damageType: 'dent', sizeClass: 'M' }], PRICE_LIST);
    expect(result.pdrMinor).toBe(400_000);
    expect(result.formula).not.toContain('×');
  });

  it('считается от базы с учётом ручных цен строк', () => {
    const result = calcAssessment(
      [{ panelCode: 'hood', damageType: 'dent', sizeClass: 'M', unitPriceMinor: 500_000 }],
      PRICE_LIST,
      { coefficientPercent: 150 },
    );
    expect(result.pdrBaseMinor).toBe(500_000);
    expect(result.totalMinor).toBe(750_000);
    // Предложение прайса коэффициент тоже учитывает: сравнивать нужно сравнимое.
    expect(result.suggestedMinor).toBe(600_000);
  });
});

describe('арматурные работы', () => {
  it('суммируются с PDR и не умножаются на коэффициент', () => {
    const result = calcAssessment(
      [{ panelCode: 'door_fl', damageType: 'dent', sizeClass: 'M', unitPriceMinor: 800_000 }],
      ARM_PRICE_LIST,
      { coefficientPercent: 100, extras: [{ priceListItemId: 'arm-door', title: 'неважно' }] },
    );
    expect(result.extras).toHaveLength(1);
    expect(result.extras[0]!.title).toBe('Разбор двери');
    expect(result.extrasMinor).toBe(200_000);
    expect(result.totalMinor).toBe(1_000_000);
  });

  it('коэффициент двигает только PDR', () => {
    const result = calcAssessment(
      [{ panelCode: 'door_fl', damageType: 'dent', sizeClass: 'M', unitPriceMinor: 800_000 }],
      ARM_PRICE_LIST,
      { coefficientPercent: 120, extras: [{ priceListItemId: 'arm-door', title: 'неважно' }] },
    );
    expect(result.pdrMinor).toBe(960_000);
    expect(result.extrasMinor).toBe(200_000);
    expect(result.totalMinor).toBe(1_160_000);
    expect(result.formula).toContain('арматурные работы');
  });

  it('цену арматурной работы можно переписать вручную', () => {
    const result = calcAssessment([], ARM_PRICE_LIST, {
      extras: [{ priceListItemId: 'arm-door', title: 'Разбор двери', unitPriceMinor: 300_000 }],
    });
    expect(result.extras[0]!.overridden).toBe(true);
    expect(result.extras[0]!.suggestedUnitPriceMinor).toBe(200_000);
    expect(result.extrasMinor).toBe(300_000);
  });

  it('позиция прайса для повреждения арматурной работой не становится', () => {
    const result = calcAssessment([], ARM_PRICE_LIST, {
      extras: [{ priceListItemId: 'hood-dent-m', title: 'Своя работа', unitPriceMinor: 50_000 }],
    });
    expect(result.extras[0]!.priceListItemId).toBeNull();
    expect(result.extras[0]!.title).toBe('Своя работа');
    expect(result.extrasMinor).toBe(50_000);
  });
});
