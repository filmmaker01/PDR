/**
 * Расчёт предварительной оценки ремонта по параметрам повреждения.
 *
 * Логика живёт в shared, а не в backend: тот же расчёт показывается в Mini App
 * сразу при вводе размеров, до обращения к серверу. Сервер пересчитывает всё
 * заново и не доверяет присланным суммам — расхождение означало бы, что
 * клиент подобрал цену сам.
 *
 * Расчёт всегда предварительный. Итог правится мастером вручную, и правка
 * не «портит» расчёт: предложение и утверждённая сумма хранятся отдельно.
 */

import { SIZE_CLASSES, type SizeClassOption } from '../pdr.js';
import { lineTotal, roundHalfUp, type Minor } from './money.js';

/** Позиция прайса в том виде, в каком её знает расчёт. */
export interface PriceRule {
  id: string;
  kind: 'damage' | 'disassembly' | 'extra';
  title: string;
  panelCode: string | null;
  damageType: string | null;
  sizeClass: string | null;
  unitPriceMinor: Minor;
  unit: 'per_item' | 'per_dent' | 'per_hour';
  isActive: boolean;
}

export interface DamageParams {
  panelCode: string;
  damageType?: string | null;
  sizeClass?: string | null;
  /** Размеры области повреждения в миллиметрах: 40×40 см — это 400×400. */
  widthMm?: number | null;
  heightMm?: number | null;
  quantity?: number | null;
  material?: 'steel' | 'aluminum' | 'other' | null;
  accessDifficulty?: 'easy' | 'medium' | 'hard' | null;
  onEdge?: boolean | null;
}

/**
 * Надбавки за то, что удлиняет работу. Значения — коэффициенты к цене
 * позиции прайса. Это отраслевая практика PDR: алюминий тянется хуже стали,
 * закрытая полость требует разборки, ребро жёсткости выправляется дольше всего.
 */
export const ASSESSMENT_MULTIPLIERS = {
  material: { steel: 1, aluminum: 1.3, other: 1 },
  accessDifficulty: { easy: 1, medium: 1.15, hard: 1.4 },
  onEdge: 1.25,
} as const;

/** Верхние границы размерных классов в миллиметрах: S ≤ 20, M ≤ 50, L ≤ 100. */
const SIZE_CLASS_LIMITS_MM: readonly { code: string; maxMm: number }[] = [
  { code: 'S', maxMm: 20 },
  { code: 'M', maxMm: 50 },
  { code: 'L', maxMm: 100 },
];

/**
 * Размерный класс по габаритам области повреждения.
 * Берётся большая сторона: вмятина 10×60 мм по трудоёмкости ближе к L, чем к S.
 */
export function sizeClassForDimensions(
  widthMm: number | null | undefined,
  heightMm: number | null | undefined,
): string | null {
  const values = [widthMm, heightMm].filter(
    (v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0,
  );
  if (values.length === 0) return null;
  const longest = Math.max(...values);
  const found = SIZE_CLASS_LIMITS_MM.find((limit) => longest <= limit.maxMm);
  return found?.code ?? 'XL';
}

/** Подсказка по размерному классу для интерфейса. */
export function sizeClassOption(code: string | null | undefined): SizeClassOption | null {
  if (!code) return null;
  return SIZE_CLASSES.find((size) => size.code === code) ?? null;
}

/**
 * Насколько позиция прайса подходит повреждению.
 * Возвращает null, если позиция противоречит параметрам: совпадение по
 * элементу кузова и типу повреждения обязано быть точным, если оно указано
 * в прайсе. Чем больше совпавших признаков, тем выше вес.
 */
export function matchScore(
  rule: PriceRule,
  params: DamageParams,
  sizeClass: string | null,
): number | null {
  if (!rule.isActive) return null;
  if (rule.kind !== 'damage') return null;

  let score = 0;

  if (rule.panelCode !== null) {
    if (rule.panelCode !== params.panelCode) return null;
    score += 4;
  }

  if (rule.damageType !== null) {
    if (params.damageType && rule.damageType !== params.damageType) return null;
    if (!params.damageType) return null;
    score += 2;
  }

  if (rule.sizeClass !== null) {
    if (sizeClass && rule.sizeClass !== sizeClass) return null;
    if (!sizeClass) return null;
    score += 1;
  }

  return score;
}

/** Позиция прайса, которая лучше всего описывает повреждение. */
export function findPriceRule(
  rules: readonly PriceRule[],
  params: DamageParams,
  sizeClass: string | null,
): PriceRule | null {
  let best: { rule: PriceRule; score: number } | null = null;
  for (const rule of rules) {
    const score = matchScore(rule, params, sizeClass);
    if (score === null) continue;
    // При равном весе выигрывает первая позиция: прайс упорядочен мастером.
    if (!best || score > best.score) best = { rule, score };
  }
  return best?.rule ?? null;
}

export interface AssessmentSuggestion {
  /** Найденная позиция прайса или null, если прайс не покрывает повреждение. */
  priceListItemId: string | null;
  priceListTitle: string | null;
  sizeClass: string | null;
  quantity: number;
  /** Базовая цена из прайса до надбавок. */
  basePriceMinor: Minor;
  /** Применённые коэффициенты: показываются мастеру, чтобы расчёт не был чёрным ящиком. */
  multipliers: { reason: string; factor: number }[];
  unitPriceMinor: Minor;
  lineTotalMinor: Minor;
  /** Человеческое объяснение расчёта одной строкой. */
  explanation: string;
}

/**
 * Предварительная стоимость одного повреждения по прайсу мастерской.
 *
 * Если подходящей позиции прайса нет, возвращается нулевая цена с понятным
 * объяснением: мастер введёт сумму руками, а не получит выдуманное число.
 */
export function suggestDamagePrice(
  params: DamageParams,
  rules: readonly PriceRule[],
): AssessmentSuggestion {
  const sizeClass =
    params.sizeClass ?? sizeClassForDimensions(params.widthMm, params.heightMm) ?? null;
  const quantity = Math.max(1, Math.trunc(params.quantity ?? 1));
  const rule = findPriceRule(rules, params, sizeClass);

  if (!rule) {
    return {
      priceListItemId: null,
      priceListTitle: null,
      sizeClass,
      quantity,
      basePriceMinor: 0,
      multipliers: [],
      unitPriceMinor: 0,
      lineTotalMinor: 0,
      explanation: 'В прайсе нет подходящей позиции — укажите стоимость вручную',
    };
  }

  const multipliers: { reason: string; factor: number }[] = [];

  if (params.material && params.material !== 'steel') {
    const factor = ASSESSMENT_MULTIPLIERS.material[params.material];
    if (factor !== 1) multipliers.push({ reason: 'алюминий', factor });
  }
  if (params.accessDifficulty && params.accessDifficulty !== 'easy') {
    multipliers.push({
      reason: params.accessDifficulty === 'hard' ? 'сложный доступ' : 'средний доступ',
      factor: ASSESSMENT_MULTIPLIERS.accessDifficulty[params.accessDifficulty],
    });
  }
  if (params.onEdge) {
    multipliers.push({ reason: 'на ребре', factor: ASSESSMENT_MULTIPLIERS.onEdge });
  }

  const basePriceMinor = rule.unitPriceMinor;
  const combined = multipliers.reduce((acc, m) => acc * m.factor, 1);
  const unitPriceMinor = roundHalfUp(basePriceMinor * combined);

  const tail = multipliers.length
    ? ` + ${multipliers.map((m) => `${m.reason} ×${m.factor}`).join(', ')}`
    : '';
  const size = sizeClass ? `, размер ${sizeClass}` : '';
  const count = quantity > 1 ? ` × ${quantity}` : '';

  return {
    priceListItemId: rule.id,
    priceListTitle: rule.title,
    sizeClass,
    quantity,
    basePriceMinor,
    multipliers,
    unitPriceMinor,
    lineTotalMinor: lineTotal(quantity, unitPriceMinor),
    explanation: `«${rule.title}»${size}${tail}${count}`,
  };
}

export interface AssessmentLineInput extends DamageParams {
  damageId?: string | null;
  /** Цена, введённая мастером. Перебивает расчёт. */
  unitPriceMinor?: Minor | null;
  comment?: string | null;
}

export interface AssessmentLineResult extends AssessmentSuggestion {
  damageId: string | null;
  position: number;
  panelCode: string;
  damageType: string | null;
  /** Цена, которую предложил расчёт. Остаётся видимой после правки мастером. */
  suggestedUnitPriceMinor: Minor;
  /** Правил ли мастер цену этой строки. */
  overridden: boolean;
  comment: string | null;
}

export interface AssessmentResult {
  lines: AssessmentLineResult[];
  /** Сумма по расчёту, до правок мастера. */
  suggestedMinor: Minor;
  /** Сумма с учётом введённых вручную цен строк. */
  totalMinor: Minor;
  explanation: string;
}

/** Полный расчёт оценки по списку повреждений. */
export function calcAssessment(
  lines: readonly AssessmentLineInput[],
  rules: readonly PriceRule[],
): AssessmentResult {
  const results = lines.map((line, index): AssessmentLineResult => {
    const suggestion = suggestDamagePrice(line, rules);
    const overridden =
      typeof line.unitPriceMinor === 'number' && line.unitPriceMinor !== suggestion.unitPriceMinor;
    const unitPriceMinor = overridden
      ? Math.max(0, Math.trunc(line.unitPriceMinor as number))
      : suggestion.unitPriceMinor;

    return {
      ...suggestion,
      damageId: line.damageId ?? null,
      position: index + 1,
      panelCode: line.panelCode,
      damageType: line.damageType ?? null,
      suggestedUnitPriceMinor: suggestion.unitPriceMinor,
      unitPriceMinor,
      lineTotalMinor: lineTotal(suggestion.quantity, unitPriceMinor),
      overridden,
      comment: line.comment ?? null,
    };
  });

  return {
    lines: results,
    suggestedMinor: results.reduce(
      (sum, line) => sum + lineTotal(line.quantity, line.suggestedUnitPriceMinor),
      0,
    ),
    totalMinor: results.reduce((sum, line) => sum + line.lineTotalMinor, 0),
    explanation: results.map((line) => line.explanation).join('; '),
  };
}
