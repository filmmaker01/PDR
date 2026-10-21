import { describe, expect, it } from 'vitest';
import { VEHICLE_CONDITION_ITEMS } from './enums/index';
import {
  VEHICLE_CONDITION_LABELS,
  normalizeVehicleCondition,
  toggleVehicleCondition,
} from './vehicle-condition';

describe('чек-лист состояния автомобиля', () => {
  it('у каждого пункта есть подпись', () => {
    for (const item of VEHICLE_CONDITION_ITEMS) {
      expect(VEHICLE_CONDITION_LABELS[item]).toBeTruthy();
    }
  });

  it('одно нажатие отмечает пункт, повторное — снимает', () => {
    const checked = toggleVehicleCondition([], 'no_valuables');
    expect(checked).toEqual(['no_valuables']);
    expect(toggleVehicleCondition(checked, 'no_valuables')).toEqual([]);
  });

  it('грязный и чистый не отмечаются вместе', () => {
    const dirty = toggleVehicleCondition(['battery_disconnected'], 'dirty');
    expect(dirty).toEqual(['dirty', 'battery_disconnected']);
    expect(toggleVehicleCondition(dirty, 'clean')).toEqual(['clean', 'battery_disconnected']);
  });

  it('порядок всегда как в справочнике', () => {
    expect(toggleVehicleCondition(['battery_disconnected'], 'clean')).toEqual([
      'clean',
      'battery_disconnected',
    ]);
  });

  it('нормализация убирает повторы и противоречия', () => {
    expect(normalizeVehicleCondition(['no_valuables', 'dirty', 'no_valuables', 'clean'])).toEqual([
      'clean',
      'no_valuables',
    ]);
  });
});
