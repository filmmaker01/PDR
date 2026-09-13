/** Нормализация пользовательского ввода: телефоны, госномера, VIN. */

/**
 * Телефон → E.164 при возможности.
 * Российские номера: 8XXXXXXXXXX и 9XXXXXXXXX приводятся к +7XXXXXXXXXX.
 * Иначе, если начинается с +, оставляем цифры. Возвращает null, если не похоже на номер.
 */
export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 5 || digits.length > 15) return null;
  if (!hasPlus) {
    if (digits.length === 11 && (digits.startsWith('8') || digits.startsWith('7'))) {
      return `+7${digits.slice(1)}`;
    }
    if (digits.length === 10 && digits.startsWith('9')) return `+7${digits}`;
  }
  return `+${digits}`;
}

export function formatPhoneRu(e164: string | null | undefined): string {
  if (!e164) return '';
  const m = /^\+7(\d{3})(\d{3})(\d{2})(\d{2})$/.exec(e164);
  return m ? `+7 ${m[1]} ${m[2]}-${m[3]}-${m[4]}` : e164;
}

const PLATE_LATIN_TO_CYRILLIC: Record<string, string> = {
  A: 'А',
  B: 'В',
  E: 'Е',
  K: 'К',
  M: 'М',
  H: 'Н',
  O: 'О',
  P: 'Р',
  C: 'С',
  T: 'Т',
  Y: 'У',
  X: 'Х',
};

/** Госномер: верхний регистр, без пробелов, латиница-омоглифы → кириллица. */
export function normalizePlate(input: string | null | undefined): string | null {
  if (!input) return null;
  const upper = input.toUpperCase().replace(/[\s-]/g, '');
  if (!upper) return null;
  const converted = [...upper].map((ch) => PLATE_LATIN_TO_CYRILLIC[ch] ?? ch).join('');
  return converted.slice(0, 15);
}

const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;

export function normalizeVin(input: string | null | undefined): string | null {
  if (!input) return null;
  const upper = input.toUpperCase().replace(/\s/g, '');
  return upper ? upper : null;
}

export function isValidVin(vin: string): boolean {
  return VIN_RE.test(vin);
}

/** Ключ поиска: нижний регистр, схлопнутые пробелы. */
export function searchKey(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, ' ');
}
