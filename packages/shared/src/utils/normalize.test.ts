import { describe, expect, it } from 'vitest';
import {
  formatPhoneInput,
  phoneInputToSubmit,
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

describe('formatPhoneInput', () => {
  it.each([
    ['8', '+7'],
    ['7', '+7'],
    ['9', '+7 9'],
    ['927', '+7 927'],
    ['89272666033', '+7 927 266-60-33'],
    ['8 927 266 60 33', '+7 927 266-60-33'],
    ['9272666033', '+7 927 266-60-33'],
    ['+7 (927) 266-60-33', '+7 927 266-60-33'],
    ['+7 927 266-60-334', '+7 927 266-60-33'],
    ['+7 927 2', '+7 927 2'],
    ['+7 927 266-', '+7 927 266'],
    ['+7 ', '+7'],
    ['+', '+'],
    ['', ''],
    ['+380 50 123 4567', '+380501234567'],
  ])('%s → %s', (input, expected) => {
    expect(formatPhoneInput(input).value).toBe(expected);
  });

  it('отформатированный номер нормализуется в тот же E.164', () => {
    expect(normalizePhone(formatPhoneInput('89272666033').value)).toBe('+79272666033');
    expect(normalizePhone(formatPhoneInput('9272666033').value)).toBe('+79272666033');
  });

  it('первая 8 — курсор сразу после +7', () => {
    expect(formatPhoneInput('8', 1)).toEqual({ value: '+7', caret: 2 });
  });

  it('первая 9 — курсор после неё, а не перед', () => {
    expect(formatPhoneInput('9', 1)).toEqual({ value: '+7 9', caret: 4 });
  });

  it('правка в середине не уводит курсор в конец', () => {
    // «+7 927 266-60-33», стёрли «7» в коде оператора: курсор после «2».
    const raw = '+7 92 266-60-33';
    expect(formatPhoneInput(raw, 5)).toEqual({ value: '+7 922 666-03-3', caret: 5 });
  });
});

describe('phoneInputToSubmit', () => {
  it.each([
    ['', null],
    ['+', null],
    ['+7', null],
    ['+7 9', '+7 9'],
    ['+7 927 266-60-33', '+7 927 266-60-33'],
  ])('%s → %s', (input, expected) => {
    expect(phoneInputToSubmit(input)).toBe(expected);
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
