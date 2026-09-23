import { useId, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
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
 * Два вида одной и той же схемы. «Автомобиль» — кузов с настоящим контуром,
 * стёклами, колёсами и зазорами между деталями: так мастер и клиент сразу
 * узнают машину. «Схема» — прежние прямоугольники: крупнее цели и проще
 * картинка, если так привычнее. Выбор запоминается на устройстве.
 *
 * Мелкие и редкие элементы — стойки, рейлинги, дверь багажника — всегда
 * доступны ещё и кнопками под схемой: на виде сверху это полосы в несколько
 * пикселей, и попадать в них пальцем не обязательно.
 */

export type CarSchemeVariant = 'realistic' | 'simple';

export interface CarSchemeProps {
  /** Сколько повреждений отмечено на каждом элементе кузова. */
  counts?: Readonly<Record<string, number>>;
  /** Выделенный элемент: обычно тот, карточка которого сейчас открыта. */
  activeCode?: string | null;
  onSelect: (panelCode: string) => void;
  disabled?: boolean;
  /** Подпись под схемой. */
  hint?: string;
  /** Вид схемы. Без него — выбор мастера на этом устройстве. */
  variant?: CarSchemeVariant;
}

const VARIANT_KEY = 'pdr.carScheme.variant';

function readVariant(): CarSchemeVariant {
  try {
    return window.localStorage.getItem(VARIANT_KEY) === 'simple' ? 'simple' : 'realistic';
  } catch {
    return 'realistic';
  }
}

function saveVariant(variant: CarSchemeVariant): void {
  try {
    window.localStorage.setItem(VARIANT_KEY, variant);
  } catch {
    // Хранилище недоступно (приватный режим) — выбор просто не запомнится.
  }
}

interface PartState {
  count: number;
  marked: boolean;
  active: boolean;
  label: string;
}

/** Общее поведение детали: нажатие, клавиатура, подпись для экранного диктора. */
function partProps(
  code: string,
  state: PartState,
  disabled: boolean | undefined,
  onSelect: (code: string) => void,
) {
  return {
    role: 'button',
    tabIndex: disabled ? -1 : 0,
    'aria-label': state.count > 0 ? `${state.label}: повреждений ${state.count}` : state.label,
    'aria-pressed': state.marked,
    onClick: () => {
      if (!disabled) onSelect(code);
    },
    onKeyDown: (event: KeyboardEvent) => {
      if (disabled) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onSelect(code);
      }
    },
  };
}

export function CarScheme({
  counts = {},
  activeCode,
  onSelect,
  disabled,
  hint,
  variant: forcedVariant,
}: CarSchemeProps) {
  const [chosen, setChosen] = useState<CarSchemeVariant>(readVariant);
  const variant = forcedVariant ?? chosen;

  const stateOf = useMemo(
    () =>
      (code: string): PartState => {
        const count = counts[code] ?? 0;
        return {
          count,
          marked: count > 0,
          active: activeCode === code,
          label: panelLabel(code) ?? code,
        };
      },
    [counts, activeCode],
  );

  const onScheme = variant === 'realistic' ? REALISTIC_CODES : SIMPLE_CODES;
  const extraCodes = BODY_PANELS.map((panel) => panel.code).filter(
    (code) => !onScheme.has(code) || SMALL_CODES.has(code),
  );

  return (
    <div className="pdr-scheme">
      {forcedVariant ? null : (
        <div className="pdr-scheme__switch" role="radiogroup" aria-label="Вид схемы">
          {(
            [
              ['realistic', 'Автомобиль'],
              ['simple', 'Схема'],
            ] as const
          ).map(([value, title]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={variant === value}
              className={clsx(
                'pdr-scheme__switch-option',
                variant === value && 'pdr-scheme__switch-option--on',
              )}
              onClick={() => {
                setChosen(value);
                saveVariant(value);
              }}
            >
              {title}
            </button>
          ))}
        </div>
      )}

      {variant === 'realistic' ? (
        <RealisticCar stateOf={stateOf} disabled={disabled} onSelect={onSelect} />
      ) : (
        <SimpleCar stateOf={stateOf} disabled={disabled} onSelect={onSelect} />
      )}

      <div className="pdr-scheme__extra">
        <div className="pdr-hint">Стойки и другие элементы</div>
        <div className="pdr-chips">
          {extraCodes.map((code) => {
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

interface CarViewProps {
  stateOf: (code: string) => PartState;
  disabled?: boolean;
  onSelect: (code: string) => void;
}

/* ------------------------------------------------------------------------ */
/* Автомобиль                                                                */
/* ------------------------------------------------------------------------ */

const CAR_WIDTH = 240;
const CAR_HEIGHT = 484;

/** Отражение левой детали на правую сторону: кузов симметричен. */
const MIRROR = `matrix(-1 0 0 1 ${CAR_WIDTH} 0)`;

/**
 * Контур кузова седана сверху: узкий нос, расширение на колёсных арках,
 * лёгкая талия на дверях. Детали ниже нарочно заходят за контур — их
 * внешний край обрезается им, и зазоры получаются там, где у машины швы.
 */
const BODY_OUTLINE =
  'M120,18 C160,18 190,22 200,34 C208,44 211,60 211,80 L212,150 ' +
  'C212,170 208,182 207,200 L207,300 C208,318 212,330 212,350 L211,420 ' +
  'C211,440 206,452 196,458 C184,464 156,466 120,466 C84,466 56,464 44,458 ' +
  'C34,452 29,440 29,420 L28,350 C28,330 32,318 33,300 L33,200 ' +
  'C32,182 28,170 28,150 L29,80 C29,60 32,44 40,34 C50,22 80,18 120,18 Z';

interface CarPart {
  code: string;
  d: string;
  /** Деталь нарисована слева; правая — её отражение. */
  side?: 'left' | 'right';
  /** Обрезать ли деталь контуром кузова. Порог — снаружи контура. */
  clip?: boolean;
  label?: { x: number; y: number; text: string; rotate?: boolean };
  badge: { x: number; y: number };
}

function sided(
  left: string,
  right: string,
  part: Omit<CarPart, 'code' | 'side'>,
): [CarPart, CarPart] {
  const mirrored = (point: { x: number; y: number }) => ({ ...point, x: CAR_WIDTH - point.x });
  return [
    { ...part, code: left, side: 'left' },
    {
      ...part,
      code: right,
      side: 'right',
      label: part.label ? { ...part.label, ...mirrored(part.label) } : undefined,
      badge: mirrored(part.badge),
    },
  ];
}

/**
 * Порядок важен: позже нарисованная деталь лежит сверху и забирает нажатие.
 * Поэтому бамперы идут последними — их шов перекрывает край капота и крыльев.
 */
const CAR_PARTS: readonly CarPart[] = [
  ...sided('fender_fl', 'fender_fr', {
    d: 'M0,30 H66 L68,160 H0 Z',
    clip: true,
    label: { x: 47, y: 104, text: 'Крыло', rotate: true },
    badge: { x: 48, y: 64 },
  }),
  ...sided('door_fl', 'door_fr', {
    d: 'M0,160 H68 V253 H0 Z',
    clip: true,
    label: { x: 50, y: 207, text: 'Дверь', rotate: true },
    badge: { x: 50, y: 174 },
  }),
  ...sided('door_rl', 'door_rr', {
    d: 'M0,253 H68 V332 H0 Z',
    clip: true,
    label: { x: 50, y: 293, text: 'Дверь', rotate: true },
    badge: { x: 50, y: 266 },
  }),
  ...sided('quarter_l', 'quarter_r', {
    d: 'M0,332 H68 L66,470 H0 Z',
    clip: true,
    label: { x: 47, y: 386, text: 'Крыло', rotate: true },
    badge: { x: 48, y: 346 },
  }),
  {
    code: 'hood',
    d: 'M64,30 C61,80 63,128 70,160 Q120,152 170,160 C177,128 179,80 176,30 Z',
    clip: true,
    label: { x: 120, y: 106, text: 'Капот' },
    badge: { x: 158, y: 66 },
  },
  {
    code: 'roof',
    d: 'M80,207 Q120,203 160,207 L164,297 Q120,301 76,297 Z',
    clip: true,
    label: { x: 120, y: 252, text: 'Крыша' },
    badge: { x: 150, y: 220 },
  },
  {
    code: 'trunk_lid',
    d: 'M68,334 Q120,342 172,334 C177,378 178,420 176,470 H64 C62,420 63,378 68,334 Z',
    clip: true,
    label: { x: 120, y: 386, text: 'Багажник' },
    badge: { x: 158, y: 354 },
  },
  {
    code: 'front_bumper',
    d: 'M0,0 H240 V42 Q120,60 0,42 Z',
    clip: true,
    label: { x: 120, y: 34, text: 'Бампер' },
    badge: { x: 176, y: 34 },
  },
  {
    code: 'rear_bumper',
    d: 'M0,484 H240 V434 Q120,418 0,434 Z',
    clip: true,
    label: { x: 120, y: 448, text: 'Бампер' },
    badge: { x: 176, y: 446 },
  },
  ...sided('sill_l', 'sill_r', {
    d: 'M17,176 Q17,170 23,170 H27 V330 H23 Q17,330 17,324 Z',
    label: { x: 22, y: 250, text: 'Порог', rotate: true },
    badge: { x: 22, y: 180 },
  }),
];

/**
 * Стойки и рейлинги видны на кузове и подсвечиваются вместе с кнопками под
 * схемой. Нажать на них можно, но на полосу в пару миллиметров никто не
 * обязан попадать — для этого и есть кнопки.
 */
const SMALL_PARTS: readonly CarPart[] = [
  ...sided('pillar_a_l', 'pillar_a_r', {
    d: 'M65,160 L72,160 L81,208 L75,208 Z',
    badge: { x: 72, y: 184 },
  }),
  ...sided('pillar_b_l', 'pillar_b_r', {
    d: 'M67,249 H77 V258 H67 Z',
    badge: { x: 73, y: 253 },
  }),
  ...sided('pillar_c_l', 'pillar_c_r', {
    d: 'M75,297 L81,297 L73,334 L67,334 Z',
    badge: { x: 74, y: 316 },
  }),
  ...sided('roof_rail_l', 'roof_rail_r', {
    d: 'M82,214 Q84,211 86,214 V290 Q84,293 82,290 Z',
    badge: { x: 84, y: 252 },
  }),
];

const REALISTIC_CODES = new Set([...CAR_PARTS, ...SMALL_PARTS].map((part) => part.code));
const SMALL_CODES = new Set(SMALL_PARTS.map((part) => part.code));

/** Стёкла — не детали кузова, но без них машина не читается. */
const GLASS: readonly { d: string; side?: 'left' | 'right' }[] = [
  { d: 'M71,161 Q120,153 169,161 L161,207 Q120,203 79,207 Z' },
  { d: 'M74,298 Q120,302 166,298 L172,334 Q120,342 68,334 Z' },
  { d: 'M67,162 L77,208 L77,297 L68,333 Z', side: 'left' },
  { d: 'M67,162 L77,208 L77,297 L68,333 Z', side: 'right' },
];

function Badge({ x, y, count }: { x: number; y: number; count: number }) {
  if (count <= 0) return null;
  return (
    <g className="pdr-car__badge" pointerEvents="none">
      <circle cx={x} cy={y} r={9} />
      <text x={x} y={y + 0.5} dominantBaseline="middle" textAnchor="middle">
        {count}
      </text>
    </g>
  );
}

function RealisticCar({ stateOf, disabled, onSelect }: CarViewProps) {
  const uid = useId().replace(/:/g, '');
  const ids = {
    clip: `${uid}-body`,
    paint: `${uid}-paint`,
    sheen: `${uid}-sheen`,
    glass: `${uid}-glass`,
    shadow: `${uid}-shadow`,
    glow: `${uid}-glow`,
  };

  const renderPart = (part: CarPart, small: boolean): ReactNode => {
    const state = stateOf(part.code);
    const transform = part.side === 'right' ? MIRROR : undefined;
    const label = part.label;
    return (
      <g
        key={part.code}
        className={clsx(
          'pdr-car__part',
          small && 'pdr-car__part--small',
          state.marked && 'pdr-car__part--marked',
          state.active && 'pdr-car__part--active',
          disabled && 'pdr-car__part--disabled',
        )}
        {...partProps(part.code, state, disabled, onSelect)}
      >
        <g clipPath={part.clip ? `url(#${ids.clip})` : undefined}>
          <path
            className="pdr-car__paint"
            d={part.d}
            transform={transform}
            fill={small ? undefined : `url(#${ids.paint})`}
          />
          <path
            className="pdr-car__tint"
            d={part.d}
            transform={transform}
            filter={state.active ? `url(#${ids.glow})` : undefined}
          />
        </g>
        {label ? (
          <text
            className="pdr-car__label"
            x={label.x}
            y={label.y}
            dominantBaseline="middle"
            textAnchor="middle"
            transform={label.rotate ? `rotate(-90 ${label.x} ${label.y})` : undefined}
          >
            {label.text}
          </text>
        ) : null}
      </g>
    );
  };

  return (
    <div className="pdr-car">
      <div className="pdr-car__direction" aria-hidden="true">
        Перед
      </div>
      <svg
        className="pdr-car__svg"
        viewBox={`0 0 ${CAR_WIDTH} ${CAR_HEIGHT}`}
        role="group"
        aria-label="Автомобиль сверху: выберите повреждённую деталь"
      >
        <defs>
          <clipPath id={ids.clip}>
            <path d={BODY_OUTLINE} />
          </clipPath>
          {/* Кузов «круглый»: к краям темнее, по центру — отблеск. */}
          <linearGradient id={ids.paint} x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="#1d2129" />
            <stop offset="0.28" stopColor="#343b48" />
            <stop offset="0.5" stopColor="#3d4554" />
            <stop offset="0.72" stopColor="#343b48" />
            <stop offset="1" stopColor="#1d2129" />
          </linearGradient>
          <linearGradient id={ids.sheen} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0.1" />
            <stop offset="0.35" stopColor="#ffffff" stopOpacity="0" />
            <stop offset="0.7" stopColor="#ffffff" stopOpacity="0.03" />
            <stop offset="1" stopColor="#000000" stopOpacity="0.18" />
          </linearGradient>
          <linearGradient id={ids.glass} x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stopColor="#1b2a3a" />
            <stop offset="0.45" stopColor="#0c131c" />
            <stop offset="0.55" stopColor="#223246" />
            <stop offset="1" stopColor="#0a0f16" />
          </linearGradient>
          <filter id={ids.shadow} x="-20%" y="-10%" width="140%" height="120%">
            <feGaussianBlur stdDeviation="7" />
          </filter>
          <filter id={ids.glow} x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="2.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Тень на полу и колёса под кузовом. */}
        <ellipse
          className="pdr-car__floor"
          cx={120}
          cy={244}
          rx={100}
          ry={226}
          filter={`url(#${ids.shadow})`}
        />
        {[92, 352].flatMap((y) =>
          (['left', 'right'] as const).map((side) => (
            <rect
              key={`wheel-${side}-${y}`}
              className="pdr-car__wheel"
              x={21}
              y={y}
              width={14}
              height={58}
              rx={5}
              transform={side === 'right' ? MIRROR : undefined}
            />
          )),
        )}

        {/* Зеркала: часть передних дверей, но отдельная цель не нужна. */}
        {(['left', 'right'] as const).map((side) => (
          <path
            key={`mirror-${side}`}
            className="pdr-car__mirror"
            d="M34,150 L19,147 Q12,149 14,158 L34,166 Z"
            transform={side === 'right' ? MIRROR : undefined}
          />
        ))}

        <path className="pdr-car__body" d={BODY_OUTLINE} fill={`url(#${ids.paint})`} />

        {CAR_PARTS.map((part) => renderPart(part, false))}

        {/* Рёбра капота и фары — только рисунок, нажатие проходит к детали. */}
        <g className="pdr-car__decor" pointerEvents="none">
          <path d="M92,58 C90,90 92,126 96,152" />
          <path d="M148,58 C150,90 148,126 144,152" />
          <path d="M96,352 Q120,357 144,352" />
        </g>
        <g pointerEvents="none">
          {(['left', 'right'] as const).map((side) => (
            <g key={`lights-${side}`} transform={side === 'right' ? MIRROR : undefined}>
              <path className="pdr-car__headlight" d="M40,40 Q52,31 70,33 L69,43 Q52,45 41,50 Z" />
              <path
                className="pdr-car__taillight"
                d="M40,446 Q52,454 70,455 L70,447 Q54,444 42,438 Z"
              />
            </g>
          ))}
        </g>

        {GLASS.map((glass, index) => (
          <path
            key={`glass-${index}`}
            className="pdr-car__glass"
            d={glass.d}
            fill={`url(#${ids.glass})`}
            transform={glass.side === 'right' ? MIRROR : undefined}
          />
        ))}

        {SMALL_PARTS.map((part) => renderPart(part, true))}

        {/* Блик по всему кузову поверх деталей: машина выглядит лакированной. */}
        <path
          className="pdr-car__sheen"
          d={BODY_OUTLINE}
          fill={`url(#${ids.sheen})`}
          pointerEvents="none"
        />
        <path className="pdr-car__outline" d={BODY_OUTLINE} pointerEvents="none" />

        {[...CAR_PARTS, ...SMALL_PARTS].map((part) => (
          <Badge key={`badge-${part.code}`} {...part.badge} count={stateOf(part.code).count} />
        ))}
      </svg>
      <div className="pdr-car__legend" aria-hidden="true">
        <span className="pdr-car__legend-item pdr-car__legend-item--marked">Есть повреждение</span>
        <span className="pdr-car__legend-item pdr-car__legend-item--active">Выбрано</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Схема                                                                     */
/* ------------------------------------------------------------------------ */

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
const SIMPLE_GLASS: { x: number; y: number; w: number; h: number; rx: number }[] = [
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

const SIMPLE_CODES = new Set(REGIONS.map((region) => region.code));

function SimpleCar({ stateOf, disabled, onSelect }: CarViewProps) {
  return (
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

      {SIMPLE_GLASS.map((glass, index) => (
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
        const state = stateOf(region.code);
        return (
          <g
            key={region.code}
            className={clsx(
              'pdr-scheme__part',
              state.marked && 'pdr-scheme__part--marked',
              state.active && 'pdr-scheme__part--active',
              disabled && 'pdr-scheme__part--disabled',
            )}
            {...partProps(region.code, state, disabled, onSelect)}
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

            {state.count > 0 ? (
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
                  {state.count}
                </text>
              </>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
