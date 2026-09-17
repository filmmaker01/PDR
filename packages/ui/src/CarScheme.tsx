import { useMemo } from 'react';
import clsx from 'clsx';
import { BODY_PANELS, panelLabel } from '@pdr/shared';

/**
 * Интерактивная схема автомобиля.
 *
 * Это не иллюстрация: по каждому элементу кузова можно нажать пальцем и
 * отметить повреждение. Вид сверху выбран сознательно — именно на
 * горизонтальных поверхностях (капот, крыша, багажник) в PDR больше всего
 * работы, и они должны быть самыми крупными целями.
 *
 * Мелкие и редкие элементы — стойки, рейлинги, дверь багажника — вынесены
 * в отдельный ряд кнопок под схемой. На виде сверху они заняли бы полосы
 * в несколько пикселей, и попасть в них пальцем было бы невозможно.
 */

interface SchemeRegion {
  code: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rx: number;
  /** Короткая подпись внутри детали: полное название не влезает. */
  short: string;
  /** Подпись поворачивается для узких вертикальных деталей. */
  rotate?: boolean;
}

const VIEW_WIDTH = 240;
const VIEW_HEIGHT = 470;

/** Стёкла: не элементы кузова, но без них схема не читается как машина. */
const GLASS: { x: number; y: number; w: number; h: number; rx: number }[] = [
  { x: 74, y: 116, w: 92, h: 30, rx: 6 },
  { x: 74, y: 250, w: 92, h: 28, rx: 6 },
];

const REGIONS: readonly SchemeRegion[] = [
  { code: 'front_bumper', x: 68, y: 8, w: 104, h: 28, rx: 12, short: 'Бампер' },
  { code: 'hood', x: 68, y: 40, w: 104, h: 72, rx: 10, short: 'Капот' },
  { code: 'roof', x: 68, y: 150, w: 104, h: 96, rx: 6, short: 'Крыша' },
  { code: 'trunk_lid', x: 68, y: 282, w: 104, h: 56, rx: 10, short: 'Багажник' },
  { code: 'rear_bumper', x: 68, y: 342, w: 104, h: 28, rx: 12, short: 'Бампер' },

  { code: 'fender_fl', x: 20, y: 40, w: 44, h: 72, rx: 10, short: 'Крыло' },
  { code: 'door_fl', x: 20, y: 116, w: 44, h: 66, rx: 6, short: 'Дверь' },
  { code: 'door_rl', x: 20, y: 186, w: 44, h: 60, rx: 6, short: 'Дверь' },
  { code: 'quarter_l', x: 20, y: 250, w: 44, h: 72, rx: 10, short: 'Крыло' },
  { code: 'sill_l', x: 4, y: 116, w: 12, h: 206, rx: 6, short: 'Порог', rotate: true },

  { code: 'fender_fr', x: 176, y: 40, w: 44, h: 72, rx: 10, short: 'Крыло' },
  { code: 'door_fr', x: 176, y: 116, w: 44, h: 66, rx: 6, short: 'Дверь' },
  { code: 'door_rr', x: 176, y: 186, w: 44, h: 60, rx: 6, short: 'Дверь' },
  { code: 'quarter_r', x: 176, y: 250, w: 44, h: 72, rx: 10, short: 'Крыло' },
  { code: 'sill_r', x: 224, y: 116, w: 12, h: 206, rx: 6, short: 'Порог', rotate: true },
];

const ON_SCHEME = new Set(REGIONS.map((region) => region.code));

/** Всё, что не поместилось на схему, доступно кнопками — с тем же поведением. */
const EXTRA_CODES = BODY_PANELS.map((panel) => panel.code).filter((code) => !ON_SCHEME.has(code));

export interface CarSchemeProps {
  /** Сколько повреждений отмечено на каждом элементе кузова. */
  counts?: Readonly<Record<string, number>>;
  /** Выделенный элемент: обычно тот, карточка которого сейчас открыта. */
  activeCode?: string | null;
  onSelect: (panelCode: string) => void;
  disabled?: boolean;
  /** Подпись под схемой. */
  hint?: string;
}

export function CarScheme({ counts = {}, activeCode, onSelect, disabled, hint }: CarSchemeProps) {
  const marked = useMemo(
    () =>
      new Set(
        Object.entries(counts)
          .filter(([, n]) => n > 0)
          .map(([code]) => code),
      ),
    [counts],
  );

  return (
    <div className="pdr-scheme">
      <svg
        className="pdr-scheme__svg"
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        role="group"
        aria-label="Схема автомобиля: выберите повреждённую деталь"
      >
        {/* Силуэт кузова: тень под деталями, чтобы схема читалась как машина. */}
        <rect
          className="pdr-scheme__body"
          x={2}
          y={4}
          width={236}
          height={VIEW_HEIGHT - 96}
          rx={48}
        />

        {GLASS.map((glass, index) => (
          <rect
            key={`glass-${index}`}
            className="pdr-scheme__glass"
            x={glass.x}
            y={glass.y}
            width={glass.w}
            height={glass.h}
            rx={glass.rx}
          />
        ))}

        {REGIONS.map((region) => {
          const count = counts[region.code] ?? 0;
          const isMarked = marked.has(region.code);
          const isActive = activeCode === region.code;
          const label = panelLabel(region.code) ?? region.code;

          return (
            <g
              key={region.code}
              className={clsx(
                'pdr-scheme__part',
                isMarked && 'pdr-scheme__part--marked',
                isActive && 'pdr-scheme__part--active',
                disabled && 'pdr-scheme__part--disabled',
              )}
              role="button"
              tabIndex={disabled ? -1 : 0}
              aria-label={count > 0 ? `${label}: повреждений ${count}` : label}
              aria-pressed={isMarked}
              onClick={() => {
                if (!disabled) onSelect(region.code);
              }}
              onKeyDown={(event) => {
                if (disabled) return;
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelect(region.code);
                }
              }}
            >
              <rect
                className="pdr-scheme__shape"
                x={region.x}
                y={region.y}
                width={region.w}
                height={region.h}
                rx={region.rx}
              />
              <text
                className="pdr-scheme__label"
                x={region.x + region.w / 2}
                y={region.y + region.h / 2}
                dominantBaseline="middle"
                textAnchor="middle"
                {...(region.rotate
                  ? {
                      transform: `rotate(-90 ${region.x + region.w / 2} ${region.y + region.h / 2})`,
                    }
                  : {})}
              >
                {region.short}
              </text>

              {count > 0 ? (
                <>
                  <circle
                    className="pdr-scheme__badge"
                    cx={region.x + region.w - 12}
                    cy={region.y + 12}
                    r={9}
                  />
                  <text
                    className="pdr-scheme__badge-text"
                    x={region.x + region.w - 12}
                    y={region.y + 12}
                    dominantBaseline="middle"
                    textAnchor="middle"
                  >
                    {count}
                  </text>
                </>
              ) : null}
            </g>
          );
        })}
      </svg>

      <div className="pdr-scheme__extra">
        <div className="pdr-hint">Стойки и другие элементы</div>
        <div className="pdr-chips">
          {EXTRA_CODES.map((code) => {
            const count = counts[code] ?? 0;
            return (
              <button
                key={code}
                type="button"
                disabled={disabled}
                className={clsx(
                  'pdr-chip',
                  count > 0 && 'pdr-chip--marked',
                  activeCode === code && 'pdr-chip--active',
                )}
                onClick={() => onSelect(code)}
              >
                {panelLabel(code)}
                {count > 0 ? ` · ${count}` : ''}
              </button>
            );
          })}
        </div>
      </div>

      {hint ? <div className="pdr-hint">{hint}</div> : null}
    </div>
  );
}
