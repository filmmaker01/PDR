import { describe, expect, it } from 'vitest';
import {
  applyPaymentEntry,
  calcDiscountMinor,
  calcEstimateTotals,
  calcPaymentStatus,
  parseMajorToMinor,
  roundHalfUp,
} from './money.js';

describe('roundHalfUp', () => {
  it('rounds .5 away from zero', () => {
    expect(roundHalfUp(2.5)).toBe(3);
    expect(roundHalfUp(-2.5)).toBe(-3);
    expect(roundHalfUp(2.4)).toBe(2);
  });
});

describe('calcDiscountMinor', () => {
  it('percent discount rounds half up', () => {
    expect(calcDiscountMinor(10_005, { kind: 'percent', value: 10 })).toBe(1001);
  });
  it('clamps percent to 0..100', () => {
    expect(calcDiscountMinor(1000, { kind: 'percent', value: 150 })).toBe(1000);
    expect(calcDiscountMinor(1000, { kind: 'percent', value: -5 })).toBe(0);
  });
  it('fixed discount never exceeds subtotal', () => {
    expect(calcDiscountMinor(1000, { kind: 'fixed', value: 5000 })).toBe(1000);
  });
  it('none is zero', () => {
    expect(calcDiscountMinor(1000, { kind: 'none' })).toBe(0);
  });
});

describe('calcEstimateTotals', () => {
  it('sums lines and applies discount', () => {
    const totals = calcEstimateTotals(
      [
        { quantity: 12, unitPriceMinor: 150_000 },
        { quantity: 1, unitPriceMinor: 300_000 },
      ],
      { kind: 'percent', value: 10 },
    );
    expect(totals.subtotalMinor).toBe(2_100_000);
    expect(totals.discountMinor).toBe(210_000);
    expect(totals.totalMinor).toBe(1_890_000);
  });
  it('rejects fractional quantity', () => {
    expect(() =>
      calcEstimateTotals([{ quantity: 1.5, unitPriceMinor: 100 }], { kind: 'none' }),
    ).toThrow();
  });
});

describe('calcPaymentStatus', () => {
  it.each([
    [null, 0, 'unpaid'],
    [null, 500, 'partial'],
    [1000, 0, 'unpaid'],
    [1000, 400, 'partial'],
    [1000, 1000, 'paid'],
    [1000, 1500, 'overpaid'],
  ] as const)('agreed=%s paid=%s → %s', (agreed, paid, expected) => {
    expect(calcPaymentStatus(agreed, paid)).toBe(expected);
  });
});

describe('applyPaymentEntry', () => {
  it('payment adds, refund and correction subtract', () => {
    let paid = 0;
    paid = applyPaymentEntry(paid, { kind: 'payment', amountMinor: 10_000 });
    paid = applyPaymentEntry(paid, { kind: 'refund', amountMinor: 2_000 });
    paid = applyPaymentEntry(paid, { kind: 'correction', amountMinor: 1_000 });
    expect(paid).toBe(7_000);
  });
});

describe('parseMajorToMinor', () => {
  it.each([
    ['1 234,50', 123_450],
    ['1234.5', 123_450],
    ['0', 0],
    ['12,345', null],
    ['abc', null],
  ])('%s → %s', (input, expected) => {
    expect(parseMajorToMinor(input)).toBe(expected);
  });
});
