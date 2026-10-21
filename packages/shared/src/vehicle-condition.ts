import { VEHICLE_CONDITION_ITEMS, type VehicleConditionItem } from './enums/index.js';

export const VEHICLE_CONDITION_LABELS: Readonly<Record<VehicleConditionItem, string>> = {
  dirty: 'Грязный автомобиль',
  clean: 'Чистый автомобиль',
  no_valuables: 'Ценных вещей нет',
  battery_disconnected: 'Аккумулятор отключён',
};

/** Пункты, которые не бывают отмечены вместе: машина либо грязная, либо чистая. */
const EXCLUSIVE: Readonly<Partial<Record<VehicleConditionItem, VehicleConditionItem>>> = {
  dirty: 'clean',
  clean: 'dirty',
};

/**
 * Отметить или снять пункт чек-листа.
 * Результат всегда в порядке справочника и без повторов: так его можно
 * сравнивать и хранить, не заботясь о том, в каком порядке нажимали.
 */
export function toggleVehicleCondition(
  checked: readonly VehicleConditionItem[],
  item: VehicleConditionItem,
): VehicleConditionItem[] {
  const next = new Set(checked);
  if (next.has(item)) {
    next.delete(item);
  } else {
    next.add(item);
    const opposite = EXCLUSIVE[item];
    if (opposite) next.delete(opposite);
  }
  return VEHICLE_CONDITION_ITEMS.filter((key) => next.has(key));
}

/** Нормализация пришедшего списка: порядок справочника, без повторов и противоречий. */
export function normalizeVehicleCondition(
  checked: readonly VehicleConditionItem[],
): VehicleConditionItem[] {
  return checked.reduce<VehicleConditionItem[]>(
    (acc, item) => (acc.includes(item) ? acc : toggleVehicleCondition(acc, item)),
    [],
  );
}
