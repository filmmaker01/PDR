import { describe, expect, it } from 'vitest';
import { CSV_BOM, buildCsv, csvRow, escapeCsvValue, minorToMajor } from './csv';

describe('CSV', () => {
  it('экранирует разделитель и кавычки', () => {
    expect(escapeCsvValue('Иванов; Иван')).toBe('"Иванов; Иван"');
    expect(escapeCsvValue('Он сказал "да"')).toBe('"Он сказал ""да"""');
  });

  it('экранирует перевод строки', () => {
    expect(escapeCsvValue('первая\nвторая')).toBe('"первая\nвторая"');
  });

  it('обезвреживает формулы Excel', () => {
    expect(escapeCsvValue('=1+1')).toBe("'=1+1");
    expect(escapeCsvValue('+7 999 000')).toBe("'+7 999 000");
    expect(escapeCsvValue('-5')).toBe("'-5");
    expect(escapeCsvValue('@user')).toBe("'@user");
  });

  it('пустые значения не ломают строку', () => {
    expect(csvRow(['a', null, undefined, 'b'])).toBe('a;;;b');
  });

  it('логические значения читаются человеком', () => {
    expect(escapeCsvValue(true)).toBe('да');
    expect(escapeCsvValue(false)).toBe('нет');
  });

  it('даты выгружаются в ISO', () => {
    expect(escapeCsvValue(new Date('2026-05-01T10:00:00.000Z'))).toBe('2026-05-01T10:00:00.000Z');
  });

  it('файл начинается с BOM и заканчивается переводом строки', () => {
    const csv = buildCsv(['имя', 'сумма'], [['Иван', '100,00']]);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(csv).toContain('имя;сумма');
  });

  it('деньги переводятся в основные единицы с запятой', () => {
    expect(minorToMajor(123456)).toBe('1234,56');
    expect(minorToMajor(BigInt(500))).toBe('5,00');
    expect(minorToMajor(null)).toBe('');
    expect(minorToMajor(0)).toBe('0,00');
  });
});
