import { describe, expect, it } from 'vitest';
import {
  formatPhoneRu,
  isValidVin,
  normalizePhone,
  normalizePlate,
  normalizeVin,
} from './normalize.js';

describe('normalizePhone', () => {
  it.each([
    ['8 (999) 123-45-67', '+79991234567'],
    ['+7 999 123 45 67', '+79991234567'],
    ['79991234567', '+79991234567'],
    ['9991234567', '+79991234567'],
    ['+380 50 123 4567', '+380501234567'],
    ['', null],
    ['123', null],
    ['не телефон', null],
  ])('%s → %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });
});

describe('formatPhoneRu', () => {
  it('formats russian numbers', () => {
    expect(formatPhoneRu('+79991234567')).toBe('+7 999 123-45-67');
  });
  it('leaves others as is', () => {
    expect(formatPhoneRu('+380501234567')).toBe('+380501234567');
  });
});

describe('normalizePlate', () => {
  it('converts latin homoglyphs to cyrillic and strips spaces', () => {
    expect(normalizePlate('a123bc 77')).toBe('А123ВС77');
    expect(normalizePlate('А123ВС77')).toBe('А123ВС77');
  });
});

describe('vin', () => {
  it('validates 17 chars without I,O,Q', () => {
    expect(isValidVin('WVWZZZ1JZXW000001')).toBe(true);
    expect(isValidVin('WVWZZZ1JZXW00001')).toBe(false);
    expect(isValidVin('WVWZZZ1JZXW0000I1')).toBe(false);
  });
  it('normalizes case', () => {
    expect(normalizeVin(' wvwzzz1jzxw000001 ')).toBe('WVWZZZ1JZXW000001');
  });
});
