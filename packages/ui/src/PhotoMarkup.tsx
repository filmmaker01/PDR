import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import clsx from 'clsx';

/**
 * Разметка повреждения на фотографии.
 *
 * Оригинал снимка не меняется никогда: разметка живёт отдельным слоем из
 * векторных фигур, а «сведённая» картинка собирается по запросу. Благодаря
 * этому в спорной ситуации видно и исходное состояние детали, и ровно ту
 * вмятину, которую согласовали в работу.
 *
 * Координаты нормированы к 0–1 от размеров снимка: разметку рисуют пальцем на
 * телефоне, а смотрят иногда с большого экрана, и она обязана лечь одинаково.
 */

export type MarkupTool = 'free' | 'circle' | 'arrow';

export interface MarkupFreeShape {
  type: 'free';
  color?: string;
  width?: number;
  points: [number, number][];
}

export interface MarkupCircleShape {
  type: 'circle';
  color?: string;
  width?: number;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

export interface MarkupArrowShape {
  type: 'arrow';
  color?: string;
  width?: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export type MarkupShape = MarkupFreeShape | MarkupCircleShape | MarkupArrowShape;

export interface MarkupDoc {
  v: 1;
  shapes: MarkupShape[];
}

export const EMPTY_MARKUP: MarkupDoc = { v: 1, shapes: [] };

/** Толщина линии в долях ширины снимка: на любом размере выглядит одинаково. */
const DEFAULT_WIDTH = 0.008;
const DEFAULT_COLOR = '#ff3b30';

const TOOLS: { value: MarkupTool; label: string }[] = [
  { value: 'free', label: 'Кисть' },
  { value: 'circle', label: 'Обводка' },
  { value: 'arrow', label: 'Стрелка' },
];

export interface PhotoMarkupProps {
  /** Адрес оригинала. Он только показывается и никогда не перезаписывается. */
  src: string;
  value: MarkupDoc;
  onChange: (next: MarkupDoc) => void;
  color?: string;
  disabled?: boolean;
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Путь свободной линии: доли 0–1 разворачиваются в координаты снимка. */
function freePath(shape: MarkupFreeShape, size: { w: number; h: number }): string {
  return shape.points
    .map(
      ([x, y], index) =>
        `${index === 0 ? 'M' : 'L'}${(x * size.w).toFixed(2)},${(y * size.h).toFixed(2)}`,
    )
    .join(' ');
}

export function PhotoMarkup({
  src,
  value,
  onChange,
  color = DEFAULT_COLOR,
  disabled,
}: PhotoMarkupProps) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [tool, setTool] = useState<MarkupTool>('free');
  const [draft, setDraft] = useState<MarkupShape | null>(null);
  /**
   * Пропорции снимка. Слой разметки рисуется в системе координат самой
   * фотографии, иначе на широком кадре круг превратился бы в овал, а
   * толщина линии по горизонтали отличалась бы от вертикальной.
   */
  const [size, setSize] = useState({ w: 1000, h: 1000 });
  const drawing = useRef(false);

  const toLocal = useCallback((event: { clientX: number; clientY: number }): [number, number] => {
    const rect = surfaceRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return [0, 0];
    return [
      clamp01((event.clientX - rect.left) / rect.width),
      clamp01((event.clientY - rect.top) / rect.height),
    ];
  }, []);

  const start = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (disabled) return;
      // Захват указателя: палец уезжает за край снимка, а линия должна
      // продолжаться, а не обрываться на границе элемента.
      event.currentTarget.setPointerCapture(event.pointerId);
      drawing.current = true;
      const [x, y] = toLocal(event);

      if (tool === 'free')
        setDraft({ type: 'free', color, width: DEFAULT_WIDTH, points: [[x, y]] });
      if (tool === 'circle') {
        setDraft({ type: 'circle', color, width: DEFAULT_WIDTH, cx: x, cy: y, rx: 0, ry: 0 });
      }
      if (tool === 'arrow') {
        setDraft({ type: 'arrow', color, width: DEFAULT_WIDTH, x1: x, y1: y, x2: x, y2: y });
      }
    },
    [color, disabled, tool, toLocal],
  );

  const move = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!drawing.current || disabled) return;
      const [x, y] = toLocal(event);

      setDraft((current) => {
        if (!current) return current;
        if (current.type === 'free') {
          const last = current.points.at(-1);
          // Точки ближе четверти процента ширины ничего не добавляют к линии,
          // зато раздувают сохраняемый документ в разы.
          if (last && Math.abs(last[0] - x) < 0.0025 && Math.abs(last[1] - y) < 0.0025) {
            return current;
          }
          return { ...current, points: [...current.points, [x, y]] };
        }
        if (current.type === 'circle') {
          return { ...current, rx: Math.abs(x - current.cx), ry: Math.abs(y - current.cy) };
        }
        return { ...current, x2: x, y2: y };
      });
    },
    [disabled, toLocal],
  );

  const finish = useCallback(() => {
    if (!drawing.current) return;
    drawing.current = false;

    setDraft((current) => {
      if (!current) return null;
      // Случайный тап не должен оставлять точку-артефакт поверх снимка.
      const meaningful =
        current.type === 'free'
          ? current.points.length > 1
          : current.type === 'circle'
            ? current.rx > 0.01 && current.ry > 0.01
            : Math.hypot(current.x2 - current.x1, current.y2 - current.y1) > 0.02;

      if (meaningful) onChange({ v: 1, shapes: [...value.shapes, current] });
      return null;
    });
  }, [onChange, value.shapes]);

  useEffect(() => {
    // Страховка: если указатель потерялся (свернули приложение), незавершённая
    // фигура не должна висеть на экране до следующего касания.
    const cancel = () => {
      drawing.current = false;
      setDraft(null);
    };
    window.addEventListener('pointercancel', cancel);
    return () => window.removeEventListener('pointercancel', cancel);
  }, []);

  const undo = () => onChange({ v: 1, shapes: value.shapes.slice(0, -1) });
  const clear = () => onChange({ v: 1, shapes: [] });

  const shapes = draft ? [...value.shapes, draft] : value.shapes;

  return (
    <div className="pdr-markup">
      <div
        ref={surfaceRef}
        className={clsx('pdr-markup__surface', disabled && 'pdr-markup__surface--disabled')}
        /*
         * Высота ограничивается через ширину, а не через max-height снимка:
         * поля от object-fit увели бы разметку мимо вмятины. Так изображение
         * и слой разметки масштабируются вместе, а лист остаётся прокручиваемым.
         */
        style={{ maxWidth: `calc(58vh * ${(size.w / size.h).toFixed(4)})` }}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={finish}
        onPointerCancel={finish}
      >
        <img
          className="pdr-markup__image"
          src={src}
          alt="Фотография повреждения"
          draggable={false}
          onLoad={(event) => {
            const img = event.currentTarget;
            if (img.naturalWidth > 0 && img.naturalHeight > 0) {
              setSize({ w: img.naturalWidth, h: img.naturalHeight });
            }
          }}
        />
        <svg
          className="pdr-markup__layer"
          viewBox={`0 0 ${size.w} ${size.h}`}
          preserveAspectRatio="none"
          aria-hidden
        >
          <defs>
            <marker
              id="pdr-markup-arrow"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="5"
              markerHeight="5"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill={color} />
            </marker>
          </defs>

          {shapes.map((shape, index) => {
            const stroke = shape.color ?? color;
            const strokeWidth = Math.max(2, (shape.width ?? DEFAULT_WIDTH) * size.w);

            if (shape.type === 'free') {
              return (
                <path
                  key={index}
                  d={freePath(shape, size)}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={strokeWidth}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              );
            }
            if (shape.type === 'circle') {
              return (
                <ellipse
                  key={index}
                  cx={shape.cx * size.w}
                  cy={shape.cy * size.h}
                  rx={shape.rx * size.w}
                  ry={shape.ry * size.h}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={strokeWidth}
                />
              );
            }
            return (
              <line
                key={index}
                x1={shape.x1 * size.w}
                y1={shape.y1 * size.h}
                x2={shape.x2 * size.w}
                y2={shape.y2 * size.h}
                stroke={stroke}
                strokeWidth={strokeWidth}
                strokeLinecap="round"
                markerEnd="url(#pdr-markup-arrow)"
              />
            );
          })}
        </svg>
      </div>

      {!disabled ? (
        <>
          <div className="pdr-chips">
            {TOOLS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={clsx('pdr-chip', tool === option.value && 'pdr-chip--active')}
                onClick={() => setTool(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="pdr-row">
            <button
              type="button"
              className="pdr-btn pdr-btn--secondary pdr-btn--sm pdr-grow"
              disabled={value.shapes.length === 0}
              onClick={undo}
            >
              Отменить
            </button>
            <button
              type="button"
              className="pdr-btn pdr-btn--secondary pdr-btn--sm pdr-grow"
              disabled={value.shapes.length === 0}
              onClick={clear}
            >
              Очистить
            </button>
          </div>
          <div className="pdr-hint">
            Оригинал фотографии сохраняется отдельно — разметку можно поправить или снять.
          </div>
        </>
      ) : null}
    </div>
  );
}

/**
 * Сведение снимка с разметкой в картинку.
 *
 * Нужна для печати и выгрузки: в PDF и в архив нельзя положить SVG-слой.
 * Оригинал при этом остаётся отдельным файлом, а сведённая картинка —
 * производной, которую можно перерисовать заново.
 */
export async function renderMarkupToBlob(
  imageUrl: string,
  markup: MarkupDoc,
  color = DEFAULT_COLOR,
): Promise<Blob> {
  const image = await loadImage(imageUrl);
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth || 1200;
  canvas.height = image.naturalHeight || 900;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Браузер не поддерживает 2D-канвас');

  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

  const scaleX = canvas.width;
  const scaleY = canvas.height;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const shape of markup.shapes) {
    ctx.strokeStyle = shape.color ?? color;
    ctx.fillStyle = shape.color ?? color;
    ctx.lineWidth = Math.max(2, (shape.width ?? DEFAULT_WIDTH) * canvas.width);

    if (shape.type === 'free') {
      ctx.beginPath();
      shape.points.forEach(([x, y], index) => {
        const px = x * scaleX;
        const py = y * scaleY;
        if (index === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();
    } else if (shape.type === 'circle') {
      ctx.beginPath();
      ctx.ellipse(
        shape.cx * scaleX,
        shape.cy * scaleY,
        Math.max(1, shape.rx * scaleX),
        Math.max(1, shape.ry * scaleY),
        0,
        0,
        Math.PI * 2,
      );
      ctx.stroke();
    } else {
      const x1 = shape.x1 * scaleX;
      const y1 = shape.y1 * scaleY;
      const x2 = shape.x2 * scaleX;
      const y2 = shape.y2 * scaleY;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      const angle = Math.atan2(y2 - y1, x2 - x1);
      const head = Math.max(10, ctx.lineWidth * 3);
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(
        x2 - head * Math.cos(angle - Math.PI / 7),
        y2 - head * Math.sin(angle - Math.PI / 7),
      );
      ctx.lineTo(
        x2 - head * Math.cos(angle + Math.PI / 7),
        y2 - head * Math.sin(angle + Math.PI / 7),
      );
      ctx.closePath();
      ctx.fill();
    }
  }

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error('Не удалось собрать картинку с разметкой')),
      'image/jpeg',
      0.9,
    );
  });
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    // Снимок лежит в хранилище на другом домене: без запроса доступа канвас
    // окажется «испорченным», и сведение молча перестанет работать.
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Не удалось загрузить фотографию'));
    image.src = url;
  });
}
