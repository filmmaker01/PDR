import { describe, expect, it } from 'vitest';
import {
  BODY_PANELS,
  DAMAGE_TYPES,
  SIZE_CLASSES,
  SIZE_ZONE_CLASSES,
  damageTypeLabel,
  defaultItemTitle,
  isKnownDamageType,
  isKnownPanel,
  panelLabel,
  sizeClassLabel,
} from './pdr';

describe('справочники PDR', () => {
  it('коды элементов кузова уникальны', () => {
    const codes = BODY_PANELS.map((p) => p.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('коды типов повреждений уникальны', () => {
    const codes = DAMAGE_TYPES.map((d) => d.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('размерная сетка: мелкие классы и крупные зоны', () => {
    expect(SIZE_CLASSES.map((s) => s.code)).toEqual([
      'S',
      'M',
      'L',
      'XL',
      '20x40',
      '40x40',
      '40x60',
      '60x60',
      '60x100',
      '100x100',
    ]);
  });

  it('у зон есть габариты, у классов вмятин — нет', () => {
    expect(SIZE_ZONE_CLASSES.map((s) => s.code)).toEqual([
      '20x40',
      '40x40',
      '40x60',
      '60x60',
      '60x100',
      '100x100',
    ]);
    expect(SIZE_ZONE_CLASSES.every((s) => s.widthCm && s.heightCm)).toBe(true);
    expect(SIZE_CLASSES.find((s) => s.code === 'M')?.widthCm).toBeUndefined();
  });

  it('код зоны читается как размер', () => {
    expect(sizeClassLabel('40x60')).toBe('40×60');
    expect(sizeClassLabel('M')).toBe('M');
    expect(sizeClassLabel(null)).toBeNull();
  });

  it('переводит коды в названия', () => {
    expect(panelLabel('hood')).toBe('Капот');
    expect(damageTypeLabel('hail')).toBe('Град');
  });

  it('неизвестный код возвращается как есть, а пустой — как null', () => {
    expect(panelLabel('unknown_panel')).toBe('unknown_panel');
    expect(panelLabel(null)).toBeNull();
    expect(damageTypeLabel(undefined)).toBeNull();
  });

  it('проверяет принадлежность справочнику', () => {
    expect(isKnownPanel('door_fl')).toBe(true);
    expect(isKnownPanel('door_fx')).toBe(false);
    expect(isKnownDamageType('crease')).toBe(true);
  });
});

describe('название позиции сметы по умолчанию', () => {
  it('собирает полное название', () => {
    expect(
      defaultItemTitle({ panelCode: 'hood', damageType: 'hail', quantity: 12, sizeClass: 'S' }),
    ).toBe('Капот — град, 12 шт, S');
  });

  it('не пишет количество, если оно одно', () => {
    expect(defaultItemTitle({ panelCode: 'roof', damageType: 'dent', quantity: 1 })).toBe(
      'Крыша — вмятина',
    );
  });

  it('обходится одним элементом кузова', () => {
    expect(defaultItemTitle({ panelCode: 'door_fl' })).toBe('Дверь передняя левая');
  });

  it('возвращает запасное название, когда ничего не известно', () => {
    expect(defaultItemTitle({})).toBe('Позиция');
  });
});
