/**
 * Справочники предметной области PDR: элементы кузова, типы повреждений,
 * размеры и сложность доступа. Общие для сметы, фотографий и будущего
 * калькулятора, поэтому живут в shared, а не в интерфейсе.
 *
 * Коды стабильны: они сохраняются в позициях смет и не должны меняться
 * при правках названий.
 */

export interface PanelOption {
  code: string;
  label: string;
  /** Группа для отображения списком. */
  group: 'front' | 'left' | 'right' | 'rear' | 'top' | 'other';
  /** Алюминиевая деталь встречается чаще на этих элементах — подсказка, а не правило. */
  oftenAluminum?: boolean;
}

export const BODY_PANELS: readonly PanelOption[] = [
  { code: 'hood', label: 'Капот', group: 'front', oftenAluminum: true },
  { code: 'roof', label: 'Крыша', group: 'top' },
  { code: 'trunk_lid', label: 'Крышка багажника', group: 'rear', oftenAluminum: true },
  { code: 'tailgate', label: 'Дверь багажника', group: 'rear' },
  { code: 'front_bumper', label: 'Передний бампер', group: 'front' },
  { code: 'rear_bumper', label: 'Задний бампер', group: 'rear' },
  { code: 'fender_fl', label: 'Крыло переднее левое', group: 'left' },
  { code: 'fender_fr', label: 'Крыло переднее правое', group: 'right' },
  { code: 'door_fl', label: 'Дверь передняя левая', group: 'left' },
  { code: 'door_rl', label: 'Дверь задняя левая', group: 'left' },
  { code: 'door_fr', label: 'Дверь передняя правая', group: 'right' },
  { code: 'door_rr', label: 'Дверь задняя правая', group: 'right' },
  { code: 'quarter_l', label: 'Крыло заднее левое', group: 'left' },
  { code: 'quarter_r', label: 'Крыло заднее правое', group: 'right' },
  { code: 'sill_l', label: 'Порог левый', group: 'left' },
  { code: 'sill_r', label: 'Порог правый', group: 'right' },
  { code: 'pillar_a_l', label: 'Стойка A левая', group: 'left' },
  { code: 'pillar_a_r', label: 'Стойка A правая', group: 'right' },
  { code: 'pillar_b_l', label: 'Стойка B левая', group: 'left' },
  { code: 'pillar_b_r', label: 'Стойка B правая', group: 'right' },
  { code: 'pillar_c_l', label: 'Стойка C левая', group: 'left' },
  { code: 'pillar_c_r', label: 'Стойка C правая', group: 'right' },
  { code: 'roof_rail_l', label: 'Рейлинг левый', group: 'top' },
  { code: 'roof_rail_r', label: 'Рейлинг правый', group: 'top' },
  { code: 'other', label: 'Другой элемент', group: 'other' },
];

export const PANEL_LABELS: Readonly<Record<string, string>> = Object.fromEntries(
  BODY_PANELS.map((p) => [p.code, p.label]),
);

export function panelLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  return PANEL_LABELS[code] ?? code;
}

export interface DamageTypeOption {
  code: string;
  label: string;
  hint?: string;
}

export const DAMAGE_TYPES: readonly DamageTypeOption[] = [
  { code: 'hail', label: 'Град', hint: 'Много мелких вмятин по горизонтальным поверхностям' },
  { code: 'dent', label: 'Вмятина', hint: 'Обычная круглая вмятина' },
  { code: 'door_ding', label: 'Парковочная', hint: 'След от двери соседней машины' },
  { code: 'crease', label: 'Залом', hint: 'Вытянутая вмятина с изломом металла' },
  { code: 'sharp', label: 'Острая', hint: 'Малый диаметр, глубокая' },
  { code: 'edge', label: 'На ребре', hint: 'На канте или ребре жёсткости' },
  { code: 'oil_canning', label: 'Хлопун', hint: 'Просевшая плоскость большого размера' },
  { code: 'other', label: 'Другое' },
];

export const DAMAGE_TYPE_LABELS: Readonly<Record<string, string>> = Object.fromEntries(
  DAMAGE_TYPES.map((d) => [d.code, d.label]),
);

export function damageTypeLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  return DAMAGE_TYPE_LABELS[code] ?? code;
}

export interface SizeClassOption {
  code: string;
  label: string;
  hint: string;
}

/** Размерная сетка мастерской. Цены в прайсе привязываются к этим классам. */
export const SIZE_CLASSES: readonly SizeClassOption[] = [
  { code: 'S', label: 'S', hint: 'до 2 см' },
  { code: 'M', label: 'M', hint: '2–5 см' },
  { code: 'L', label: 'L', hint: '5–10 см' },
  { code: 'XL', label: 'XL', hint: 'больше 10 см' },
];

export const SIZE_CLASS_CODES = SIZE_CLASSES.map((s) => s.code);

export const MATERIAL_LABELS: Readonly<Record<string, string>> = {
  steel: 'Сталь',
  aluminum: 'Алюминий',
  other: 'Другое',
};

export const ACCESS_DIFFICULTY_LABELS: Readonly<Record<string, string>> = {
  easy: 'Простой доступ',
  medium: 'Средний доступ',
  hard: 'Сложный доступ',
};

export const ESTIMATE_ITEM_KIND_LABELS: Readonly<Record<string, string>> = {
  damage: 'Повреждение',
  disassembly: 'Разборка и сборка',
  extra: 'Доп. работы',
};

export const ESTIMATE_STATUS_LABELS: Readonly<Record<string, string>> = {
  draft: 'Черновик',
  sent: 'Отправлена клиенту',
  agreed: 'Согласована',
  rejected: 'Отклонена',
  superseded: 'Заменена',
};

export const PRICE_UNIT_LABELS: Readonly<Record<string, string>> = {
  per_item: 'за элемент',
  per_dent: 'за вмятину',
  per_hour: 'за час',
};

export function isKnownPanel(code: string): boolean {
  return code in PANEL_LABELS;
}

export function isKnownDamageType(code: string): boolean {
  return code in DAMAGE_TYPE_LABELS;
}

/** Название позиции сметы по умолчанию: «Капот — град, 12 шт, S». */
export function defaultItemTitle(input: {
  panelCode?: string | null;
  damageType?: string | null;
  quantity?: number | null;
  sizeClass?: string | null;
}): string {
  const panel = panelLabel(input.panelCode);
  const damage = damageTypeLabel(input.damageType)?.toLowerCase();
  const parts: string[] = [];
  if (damage) parts.push(damage);
  if (input.quantity && input.quantity > 1) parts.push(`${input.quantity} шт`);
  if (input.sizeClass) parts.push(input.sizeClass);
  const tail = parts.join(', ');
  if (panel && tail) return `${panel} — ${tail}`;
  return panel ?? (tail || 'Позиция');
}
