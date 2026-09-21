import clsx from 'clsx';

/**
 * Месячный календарь.
 *
 * Считает даты строками `YYYY-MM-DD` и полднем UTC внутри: календарь мастерской
 * живёт в её часовом поясе, а не в поясе телефона, поэтому «сегодня» и
 * выбранный день приходят снаружи готовыми строками.
 */
export interface MonthCalendarProps {
  /** Показываемый месяц, `YYYY-MM`. */
  month: string;
  /** Выбранный день, `YYYY-MM-DD`. */
  selected?: string | null;
  /** Сегодня в часовом поясе мастерской, `YYYY-MM-DD`. */
  today: string;
  /** Сколько записей в дне: индикатор под числом. */
  counts?: Record<string, number>;
  onSelect: (day: string) => void;
  onMonthChange: (month: string) => void;
}

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

function toDate(day: string): Date {
  return new Date(`${day}T12:00:00Z`);
}

function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function shiftMonth(month: string, delta: number): string {
  const [year, monthNo] = month.split('-').map(Number) as [number, number];
  const index = (year * 12 + (monthNo - 1) + delta + 12_000) % 12;
  const shiftedYear = Math.floor((year * 12 + (monthNo - 1) + delta) / 12);
  return `${shiftedYear}-${String(index + 1).padStart(2, '0')}`;
}

function monthTitle(month: string): string {
  return new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' }).format(
    toDate(`${month}-01`),
  );
}

/** Сетка месяца от понедельника: шесть недель максимум. */
function monthGrid(month: string): { day: string; inMonth: boolean }[] {
  const first = toDate(`${month}-01`);
  const weekday = (first.getUTCDay() + 6) % 7;
  const start = new Date(first);
  start.setUTCDate(start.getUTCDate() - weekday);

  const last = new Date(first);
  last.setUTCMonth(last.getUTCMonth() + 1);
  last.setUTCDate(0);
  const totalDays = weekday + last.getUTCDate();
  const weeks = Math.ceil(totalDays / 7);

  return Array.from({ length: weeks * 7 }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(date.getUTCDate() + index);
    const day = toIso(date);
    return { day, inMonth: day.slice(0, 7) === month };
  });
}

export function MonthCalendar({
  month,
  selected,
  today,
  counts,
  onSelect,
  onMonthChange,
}: MonthCalendarProps) {
  const cells = monthGrid(month);

  return (
    <div className="pdr-month">
      <div className="pdr-month__head">
        <button
          type="button"
          className="pdr-month__nav"
          aria-label="Предыдущий месяц"
          onClick={() => onMonthChange(shiftMonth(month, -1))}
        >
          ‹
        </button>
        <button
          type="button"
          className="pdr-month__title"
          onClick={() => onMonthChange(today.slice(0, 7))}
        >
          {monthTitle(month)}
        </button>
        <button
          type="button"
          className="pdr-month__nav"
          aria-label="Следующий месяц"
          onClick={() => onMonthChange(shiftMonth(month, 1))}
        >
          ›
        </button>
      </div>

      <div className="pdr-month__grid">
        {WEEKDAYS.map((weekday) => (
          <div key={weekday} className="pdr-month__weekday">
            {weekday}
          </div>
        ))}

        {cells.map((cell) => {
          const count = counts?.[cell.day] ?? 0;
          return (
            <button
              key={cell.day}
              type="button"
              className={clsx(
                'pdr-month__cell',
                !cell.inMonth && 'pdr-month__cell--other',
                cell.day === today && 'pdr-month__cell--today',
                cell.day === selected && 'pdr-month__cell--selected',
              )}
              aria-current={cell.day === today ? 'date' : undefined}
              aria-label={count > 0 ? `${cell.day}, записей: ${count}` : cell.day}
              onClick={() => onSelect(cell.day)}
            >
              <span>{Number(cell.day.slice(8))}</span>
              {/* Индикатор занятости: до трёх точек, дальше число. */}
              {count > 0 ? (
                <span className="pdr-month__marks">
                  {count <= 3 ? (
                    Array.from({ length: count }, (_, i) => (
                      <span key={i} className="pdr-month__dot" />
                    ))
                  ) : (
                    <span className="pdr-month__count">{count}</span>
                  )}
                </span>
              ) : (
                <span className="pdr-month__marks" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
