/**
 * Проверка попадания момента времени в расписание cron.
 *
 * Полноценный разбор cron здесь не нужен: расписания задаёт не пользователь,
 * а сами обработчики, и все они укладываются в пять полей со звёздочкой,
 * числом, списком, диапазоном и шагом. Нужен ответ на один вопрос —
 * наступила ли эта минута, — поэтому вычислять следующий запуск не требуется.
 *
 * Поля: минута, час, день месяца, месяц, день недели. Время — UTC.
 */

interface Field {
  min: number;
  max: number;
  value: number;
}

/** Разбор одного поля в набор допустимых значений. */
function matchField(expr: string, { min, max, value }: Field): boolean {
  for (const part of expr.split(',')) {
    if (matchPart(part.trim(), min, max, value)) return true;
  }
  return false;
}

function matchPart(part: string, min: number, max: number, value: number): boolean {
  const slices = part.split('/');
  const rangeExpr = slices[0] ?? '';
  const stepExpr = slices[1];
  const step = stepExpr === undefined ? 1 : Number(stepExpr);
  if (slices.length > 2 || !Number.isInteger(step) || step < 1) return false;

  let from: number;
  let to: number;

  if (rangeExpr === '*') {
    from = min;
    to = max;
  } else if (rangeExpr.includes('-')) {
    const bounds = rangeExpr.split('-');
    from = Number(bounds[0]);
    to = Number(bounds[1]);
  } else {
    from = Number(rangeExpr);
    to = from;
    // Без шага одиночное число — это ровно одно значение.
    if (stepExpr === undefined) return from === value;
    // С шагом (например 5/10) отсчёт идёт от числа до конца диапазона.
    to = max;
  }

  if (!Number.isInteger(from) || !Number.isInteger(to)) return false;
  if (from < min || to > max || from > to) return false;
  if (value < from || value > to) return false;

  return (value - from) % step === 0;
}

/**
 * Совпадает ли расписание с указанной минутой (UTC).
 * Некорректное выражение считается несовпадением: молча пропустить запуск
 * безопаснее, чем уронить разбор всей очереди.
 */
export function cronMatches(expression: string, at: Date): boolean {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return false;

  const [minute = '', hour = '', dayOfMonth = '', month = '', dayOfWeek = ''] = fields;

  // День месяца и день недели в cron связаны через «или», если задан
  // только один из них; здесь оба ограничения используются как «и», потому
  // что расписания обработчиков не задают их одновременно.
  return (
    matchField(minute, { min: 0, max: 59, value: at.getUTCMinutes() }) &&
    matchField(hour, { min: 0, max: 23, value: at.getUTCHours() }) &&
    matchField(dayOfMonth, { min: 1, max: 31, value: at.getUTCDate() }) &&
    matchField(month, { min: 1, max: 12, value: at.getUTCMonth() + 1 }) &&
    matchField(dayOfWeek, { min: 0, max: 6, value: at.getUTCDay() })
  );
}

/** Ключ минуты для дедупликации: один запуск расписания на одну минуту. */
export function minuteKey(at: Date): string {
  return at.toISOString().slice(0, 16);
}
