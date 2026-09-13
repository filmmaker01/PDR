/**
 * Деньги хранятся целыми числами в минимальных единицах валюты (копейки).
 * Все расчёты — только здесь, чтобы округление было одинаковым везде.
 */

export type Minor = number;

/** Округление half-up (0.5 → вверх), в отличие от Math.round для отрицательных. */
export function roundHalfUp(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

export function lineTotal(quantity: number, unitPriceMinor: Minor): Minor {
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new RangeError('quantity must be a non-negative integer');
  }
  if (!Number.isInteger(unitPriceMinor)) {
    throw new RangeError('unitPriceMinor must be an integer');
  }
  return quantity * unitPriceMinor;
}

export function sumMinor(values: readonly Minor[]): Minor {
  return values.reduce((acc, v) => acc + v, 0);
}

export type DiscountInput =
  | { kind: 'none'; value?: number }
  | { kind: 'percent'; value: number }
  | { kind: 'fixed'; value: number };

/** Скидка не может быть больше подытога и не может быть отрицательной. */
export function calcDiscountMinor(subtotalMinor: Minor, discount: DiscountInput): Minor {
  if (discount.kind === 'none') return 0;
  if (discount.kind === 'percent') {
    const pct = Math.min(Math.max(discount.value, 0), 100);
    return Math.min(roundHalfUp((subtotalMinor * pct) / 100), subtotalMinor);
  }
  return Math.min(Math.max(Math.trunc(discount.value), 0), subtotalMinor);
}

export interface EstimateTotals {
  subtotalMinor: Minor;
  discountMinor: Minor;
  totalMinor: Minor;
}

export function calcEstimateTotals(
  lines: readonly { quantity: number; unitPriceMinor: Minor }[],
  discount: DiscountInput,
): EstimateTotals {
  const subtotalMinor = sumMinor(lines.map((l) => lineTotal(l.quantity, l.unitPriceMinor)));
  const discountMinor = calcDiscountMinor(subtotalMinor, discount);
  return { subtotalMinor, discountMinor, totalMinor: subtotalMinor - discountMinor };
}

/** Статус оплаты заказа. agreedTotal === null → сметы ещё нет. */
export function calcPaymentStatus(
  agreedTotalMinor: Minor | null,
  paidMinor: Minor,
): 'unpaid' | 'partial' | 'paid' | 'overpaid' {
  if (paidMinor <= 0) return 'unpaid';
  if (agreedTotalMinor === null || agreedTotalMinor <= 0) return 'partial';
  if (paidMinor < agreedTotalMinor) return 'partial';
  if (paidMinor === agreedTotalMinor) return 'paid';
  return 'overpaid';
}

/** payment увеличивает, refund и correction уменьшают. */
export function applyPaymentEntry(
  paidMinor: Minor,
  entry: { kind: 'payment' | 'refund' | 'correction'; amountMinor: Minor },
): Minor {
  return entry.kind === 'payment' ? paidMinor + entry.amountMinor : paidMinor - entry.amountMinor;
}

export function formatMinor(minor: Minor, currency = 'RUB', locale = 'ru-RU'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(minor / 100);
}

/** Разбор ввода пользователя «1 234,50» → 123450. */
export function parseMajorToMinor(input: string): Minor | null {
  const normalized = input.replace(/\s| /g, '').replace(',', '.');
  if (!/^-?\d+(\.\d{1,2})?$/.test(normalized)) return null;
  return roundHalfUp(Number(normalized) * 100);
}
