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

/** Российский номер по мере ввода: «+7 927 266-60-33», недописанный — так же по частям. */
function formatRuPartial(national: string): string {
  let out = '+7';
  if (national.length > 0) out += ` ${national.slice(0, 3)}`;
  if (national.length > 3) out += ` ${national.slice(3, 6)}`;
  if (national.length > 6) out += `-${national.slice(6, 8)}`;
  if (national.length > 8) out += `-${national.slice(8, 10)}`;
  return out;
}

export interface PhoneInputState {
  value: string;
  /** Где оставить курсор: после того же числа цифр, что и до форматирования. */
  caret: number;
}

/**
 * Поле телефона по мере ввода.
 *
 * Мастер не набирает «+7» руками: первая 8 становится +7, номер с 9
 * получает +7 спереди, вставленный «89272666033» сразу превращается в
 * «+7 927 266-60-33». Номер, начатый с «+» и не с 7, — иностранный: его
 * не форматируем, только оставляем цифры. Хранится всё равно то, что
 * вернёт normalizePhone, — здесь только отображение.
 *
 * `caret` — позиция курсора в исходной строке; возвращается позиция в
 * отформатированной, чтобы правка в середине номера не перебрасывала
 * курсор в конец.
 */
export function formatPhoneInput(raw: string, caret: number = raw.length): PhoneInputState {
  const hasPlus = raw.trimStart().startsWith('+');
  const digits = raw.replace(/\D/g, '');
  const digitsBefore = raw.slice(0, Math.max(0, caret)).replace(/\D/g, '').length;

  if (digits.length === 0) {
    const value = hasPlus ? '+' : '';
    return { value, caret: value.length };
  }

  if (hasPlus && !digits.startsWith('7')) {
    const value = `+${digits.slice(0, 15)}`;
    return { value, caret: Math.min(value.length, 1 + digitsBefore) };
  }

  // Ведущая 7 или 8 — код страны, остальное — национальный номер. Без кода
  // (начали с 9) код дописывается, и курсор сдвигается на одну цифру.
  const hasCountry = hasPlus || digits.startsWith('7') || digits.startsWith('8');
  const national = (hasCountry ? digits.slice(1) : digits).slice(0, 10);
  const value = formatRuPartial(national);

  const target = Math.max(1, digitsBefore + (hasCountry ? 0 : 1));
  let seen = 0;
  let position = value.length;
  for (let i = 0; i < value.length; i += 1) {
    if (/\d/.test(value[i]!)) seen += 1;
    if (seen === target) {
      position = i + 1;
      break;
    }
  }
  return { value, caret: position };
}

/**
 * Что отправить на сервер из поля телефона: пустое поле и одинокий «+7»
 * (мастер нажал 8 и передумал) — это «телефона нет», а не ошибка разбора.
 */
export function phoneInputToSubmit(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, '');
  if (digits.length === 0 || (value.trim().startsWith('+7') && digits.length <= 1)) return null;
  return value.trim();
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
