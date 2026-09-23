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

import { SIZE_CLASSES, sizeClassLabel, type SizeClassOption } from '../pdr.js';
import { formatMinor, lineTotal, roundHalfUp, type Minor } from './money.js';

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

/**
 * Границы размерных классов: наибольшая сторона и площадь области, обе в
 * миллиметрах. Класс подходит, когда повреждение не выходит за обе границы.
 *
 * Только по большой стороне зоны 40×60 и 60×60 не отличить, только по площади
 * узкая вмятина 10×60 мм попала бы в класс мелочи. Поэтому проверяются оба
 * признака сразу, а сетка идёт по возрастанию.
 */
const SIZE_CLASS_LIMITS: readonly { code: string; maxLongestMm: number; maxAreaMm2: number }[] = [
  { code: 'S', maxLongestMm: 20, maxAreaMm2: 400 },
  { code: 'M', maxLongestMm: 50, maxAreaMm2: 2_500 },
  { code: 'L', maxLongestMm: 100, maxAreaMm2: 10_000 },
  { code: 'XL', maxLongestMm: 200, maxAreaMm2: 40_000 },
  { code: '20x40', maxLongestMm: 400, maxAreaMm2: 80_000 },
  { code: '40x40', maxLongestMm: 400, maxAreaMm2: 160_000 },
  { code: '40x60', maxLongestMm: 600, maxAreaMm2: 240_000 },
  { code: '60x60', maxLongestMm: 600, maxAreaMm2: 360_000 },
  { code: '60x100', maxLongestMm: 1_000, maxAreaMm2: 600_000 },
  { code: '100x100', maxLongestMm: 1_000, maxAreaMm2: 1_000_000 },
];

/** Самый крупный класс сетки: всё, что больше, считается по нему. */
const LARGEST_SIZE_CLASS = SIZE_CLASS_LIMITS[SIZE_CLASS_LIMITS.length - 1]!.code;

/**
 * Размерный класс по габаритам области повреждения.
 *
 * Одна сторона — повреждение считается круглым: 60 мм это 60×60 мм.
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
  const areaMm2 = values.length === 2 ? values[0]! * values[1]! : longest * longest;
  const found = SIZE_CLASS_LIMITS.find(
    (limit) => longest <= limit.maxLongestMm && areaMm2 <= limit.maxAreaMm2,
  );
  return found?.code ?? LARGEST_SIZE_CLASS;
}

/**
 * Повреждение крупнее самой большой зоны сетки.
 *
 * Такое считается по верхней зоне — другой цены для него в прайсе нет. Но
 * показывать его как «100×100» нельзя: мастер измерил 300×300 см и увидел бы
 * чужое число вместо своего.
 */
export function isSizeBeyondGrid(
  widthMm: number | null | undefined,
  heightMm: number | null | undefined,
): boolean {
  const values = [widthMm, heightMm].filter(
    (v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0,
  );
  if (values.length === 0) return false;
  const longest = Math.max(...values);
  const areaMm2 = values.length === 2 ? values[0]! * values[1]! : longest * longest;
  const largest = SIZE_CLASS_LIMITS[SIZE_CLASS_LIMITS.length - 1]!;
  return longest > largest.maxLongestMm || areaMm2 > largest.maxAreaMm2;
}

/** Сантиметры из миллиметров: 3000 мм → «300», 25 мм → «2,5». */
function toCm(mm: number): string {
  const cm = mm / 10;
  return Number.isInteger(cm) ? String(cm) : cm.toFixed(1).replace('.', ',');
}

export interface DamageSizeView {
  /** Фактический размер, который ввёл мастер: «300 × 300 см». */
  actual: string | null;
  /** Код тарифной зоны, по которой считается цена. */
  zoneCode: string | null;
  /** Подпись тарифной зоны: «40×40» или «100×100+» для повреждений крупнее сетки. */
  zone: string | null;
  /** Повреждение крупнее верхней зоны: цена считается по ней. */
  capped: boolean;
}

/**
 * Как показать размер повреждения.
 *
 * Разделены два разных понятия: фактический размер — то, что мастер измерил,
 * и тарифная зона — то, по чему считается цена. Раньше в карточке
 * показывалось одно вместо другого, и повреждение 300×300 см выглядело как
 * 100×100.
 */
export function describeDamageSize(
  widthMm: number | null | undefined,
  heightMm: number | null | undefined,
  sizeClass?: string | null,
): DamageSizeView {
  const width = typeof widthMm === 'number' && widthMm > 0 ? widthMm : null;
  const height = typeof heightMm === 'number' && heightMm > 0 ? heightMm : null;

  const actual =
    width && height
      ? `${toCm(width)} × ${toCm(height)} см`
      : width
        ? `${toCm(width)} см`
        : height
          ? `${toCm(height)} см`
          : null;

  const zoneCode = sizeClassForDimensions(width, height) ?? sizeClass ?? null;
  const capped = isSizeBeyondGrid(width, height);
  const zoneLabel = sizeClassLabel(zoneCode);

  return {
    actual,
    zoneCode,
    zone: zoneLabel ? `${zoneLabel}${capped ? '+' : ''}` : null,
    capped,
  };
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
  const size = sizeClass ? `, размер ${sizeClassLabel(sizeClass)}` : '';
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

// ── Коэффициент стоимости ────────────────────────────────────────────────────

/**
 * Коэффициент цены в процентах: 100 — расчёт по прайсу без изменений,
 * 50 — минус половина, 200 — вдвое дороже. Это поправка мастера под регион и
 * рынок, а не признак повреждения: размер, материал, доступ и ребро уже учтены
 * в базовом расчёте и коэффициентом не заменяются.
 */
export const PRICE_COEFFICIENT_MIN = 50;
export const PRICE_COEFFICIENT_MAX = 200;
export const PRICE_COEFFICIENT_STEP = 5;
export const DEFAULT_PRICE_COEFFICIENT = 100;

/** Коэффициент к сохранению: шаг 5 %, границы −50 %…+100 %. */
export function normalizePriceCoefficient(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_PRICE_COEFFICIENT;
  const stepped = Math.round(value / PRICE_COEFFICIENT_STEP) * PRICE_COEFFICIENT_STEP;
  return Math.min(Math.max(stepped, PRICE_COEFFICIENT_MIN), PRICE_COEFFICIENT_MAX);
}

/** Коэффициент множителем: 120 % → 1.2. */
export function priceCoefficientFactor(percent: number): number {
  return normalizePriceCoefficient(percent) / 100;
}

export function applyPriceCoefficient(baseMinor: Minor, percent: number): Minor {
  return roundHalfUp((baseMinor * normalizePriceCoefficient(percent)) / 100);
}

// ── Арматурные работы ────────────────────────────────────────────────────────

/**
 * Арматурная работа к повреждению: снятие обшивки, разбор двери, снятие фары.
 *
 * Это не повреждение и не надбавка за сложность, а отдельная работа со своей
 * ценой из справочника мастерской. Коэффициент цены к ней не применяется:
 * поправка под рынок относится к самому PDR-ремонту, а разбор двери стоит
 * столько, сколько мастерская за него берёт.
 */
export interface AssessmentExtraInput {
  /** Позиция справочника арматурных работ, если выбрана из него. */
  priceListItemId?: string | null;
  /** Повреждение, к которому относится работа: итог по детали считается по нему. */
  damageId?: string | null;
  title: string;
  quantity?: number | null;
  /** Цена из справочника. */
  suggestedUnitPriceMinor?: Minor | null;
  /** Цена, введённая мастером. Перебивает справочник. */
  unitPriceMinor?: Minor | null;
  comment?: string | null;
}

export interface AssessmentExtraResult {
  priceListItemId: string | null;
  damageId: string | null;
  position: number;
  title: string;
  quantity: number;
  suggestedUnitPriceMinor: Minor;
  unitPriceMinor: Minor;
  lineTotalMinor: Minor;
  overridden: boolean;
  comment: string | null;
}

/**
 * Цена арматурной работы: из справочника, если позиция найдена, иначе ноль
 * с ручным вводом. Название тоже берётся из справочника — интерфейс не должен
 * уметь подписать своей работой чужую цену.
 */
export function resolveExtra(
  input: AssessmentExtraInput,
  rules: readonly PriceRule[],
  position: number,
): AssessmentExtraResult {
  const rule = input.priceListItemId
    ? (rules.find((r) => r.id === input.priceListItemId && r.kind !== 'damage') ?? null)
    : null;

  const quantity = Math.max(1, Math.trunc(input.quantity ?? 1));
  const suggestedUnitPriceMinor = Math.max(
    0,
    Math.trunc(rule?.unitPriceMinor ?? input.suggestedUnitPriceMinor ?? 0),
  );
  const overridden =
    typeof input.unitPriceMinor === 'number' && input.unitPriceMinor !== suggestedUnitPriceMinor;
  const unitPriceMinor = overridden
    ? Math.max(0, Math.trunc(input.unitPriceMinor as number))
    : suggestedUnitPriceMinor;

  return {
    priceListItemId: rule?.id ?? null,
    damageId: input.damageId ?? null,
    position,
    title: (rule?.title ?? input.title).trim() || 'Арматурная работа',
    quantity,
    suggestedUnitPriceMinor,
    unitPriceMinor,
    lineTotalMinor: lineTotal(quantity, unitPriceMinor),
    overridden,
    comment: input.comment ?? null,
  };
}

// ── Итог оценки ──────────────────────────────────────────────────────────────

export interface AssessmentResult {
  lines: AssessmentLineResult[];
  /** Арматурные работы: считаются по своим ценам и суммируются с PDR. */
  extras: AssessmentExtraResult[];
  /** Сумма PDR по прайсу и правкам строк — база, к которой применяется коэффициент. */
  pdrBaseMinor: Minor;
  /** Та же база, но без правок мастера: видно, от чего он отступил. */
  pdrSuggestedBaseMinor: Minor;
  coefficientPercent: number;
  /** PDR после коэффициента. */
  pdrMinor: Minor;
  extrasMinor: Minor;
  /** Сумма, которую предложил расчёт: прайс × коэффициент + арматурные работы. */
  suggestedMinor: Minor;
  /** То же с учётом цен, введённых мастером по строкам. */
  totalMinor: Minor;
  explanation: string;
  /** Формула для интерфейса: «База 4 000 ₽ × 1.20 = 4 800 ₽». */
  formula: string;
}

export interface AssessmentOptions {
  extras?: readonly AssessmentExtraInput[];
  coefficientPercent?: number | null;
  /** Валюта для подписи формулы. */
  currency?: string;
}

/** Полный расчёт оценки по списку повреждений. */
export function calcAssessment(
  lines: readonly AssessmentLineInput[],
  rules: readonly PriceRule[],
  options: AssessmentOptions = {},
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

  const extras = (options.extras ?? []).map((extra, index) =>
    resolveExtra(extra, rules, index + 1),
  );

  const coefficientPercent = normalizePriceCoefficient(
    options.coefficientPercent ?? DEFAULT_PRICE_COEFFICIENT,
  );

  const pdrSuggestedBaseMinor = results.reduce(
    (sum, line) => sum + lineTotal(line.quantity, line.suggestedUnitPriceMinor),
    0,
  );
  const pdrBaseMinor = results.reduce((sum, line) => sum + line.lineTotalMinor, 0);
  const pdrMinor = applyPriceCoefficient(pdrBaseMinor, coefficientPercent);
  const extrasMinor = extras.reduce((sum, extra) => sum + extra.lineTotalMinor, 0);
  const extrasSuggestedMinor = extras.reduce(
    (sum, extra) => sum + lineTotal(extra.quantity, extra.suggestedUnitPriceMinor),
    0,
  );

  const explanationParts = [
    ...results.map((line) => line.explanation),
    ...extras.map((extra) =>
      extra.quantity > 1 ? `${extra.title} × ${extra.quantity}` : extra.title,
    ),
  ];

  return {
    lines: results,
    extras,
    pdrBaseMinor,
    pdrSuggestedBaseMinor,
    coefficientPercent,
    pdrMinor,
    extrasMinor,
    suggestedMinor:
      applyPriceCoefficient(pdrSuggestedBaseMinor, coefficientPercent) + extrasSuggestedMinor,
    totalMinor: pdrMinor + extrasMinor,
    explanation: explanationParts.join('; '),
    formula: priceFormula(
      { pdrBaseMinor, coefficientPercent, pdrMinor, extrasMinor },
      options.currency,
    ),
  };
}

/**
 * Формула расчёта одной строкой. Она всегда на экране рядом с итогом: мастер
 * должен видеть, из чего сложилась сумма, а не только результат.
 */
export function priceFormula(
  input: {
    pdrBaseMinor: Minor;
    coefficientPercent: number;
    pdrMinor: Minor;
    extrasMinor: Minor;
  },
  currency = 'RUB',
): string {
  const money = (value: Minor): string => formatMinor(value, currency);
  const coefficient = normalizePriceCoefficient(input.coefficientPercent);

  const pdr =
    coefficient === 100
      ? `База ${money(input.pdrBaseMinor)}`
      : `База ${money(input.pdrBaseMinor)} × ${(coefficient / 100).toFixed(2)} = ${money(input.pdrMinor)}`;

  if (input.extrasMinor === 0) return pdr;
  return `${pdr} + арматурные работы ${money(input.extrasMinor)} = ${money(
    input.pdrMinor + input.extrasMinor,
  )}`;
}
