import { describe, expect, it } from 'vitest';
import {
  BODY_PANELS,
  DAMAGE_TYPES,
  SIZE_CLASSES,
  damageTypeLabel,
  defaultItemTitle,
  isKnownDamageType,
  isKnownPanel,
  panelLabel,
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

  it('размерная сетка описана от S до XL', () => {
    expect(SIZE_CLASSES.map((s) => s.code)).toEqual(['S', 'M', 'L', 'XL']);
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
