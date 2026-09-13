import { describe, expect, it } from 'vitest';
import {
  ACTIVE_STATUSES,
  ALLOWED_TRANSITIONS,
  allowedFrom,
  canTransition,
  isOwnerOnlyTransition,
  timestampsFor,
} from './order-state-machine';

describe('переходы статуса заказа', () => {
  it('обычный путь заказа проходит целиком', () => {
    const path = [
      'new',
      'pending_approval',
      'scheduled',
      'in_progress',
      'ready',
      'delivered',
    ] as const;
    for (let i = 0; i < path.length - 1; i += 1) {
      expect(canTransition(path[i]!, path[i + 1]!)).toBe(true);
    }
  });

  it('нельзя перескочить через этапы работы', () => {
    expect(canTransition('new', 'ready')).toBe(false);
    expect(canTransition('new', 'delivered')).toBe(false);
    expect(canTransition('scheduled', 'delivered')).toBe(false);
    expect(canTransition('pending_approval', 'ready')).toBe(false);
  });

  it('выданный заказ можно вернуть только в «Готов», и это действие владельца', () => {
    expect(canTransition('delivered', 'ready')).toBe(true);
    expect(canTransition('delivered', 'in_progress')).toBe(false);
    expect(canTransition('delivered', 'cancelled')).toBe(false);
    expect(isOwnerOnlyTransition('delivered', 'ready')).toBe(true);
  });

  it('отменённый заказ возобновляет только владелец', () => {
    expect(canTransition('cancelled', 'new')).toBe(true);
    expect(canTransition('cancelled', 'in_progress')).toBe(false);
    expect(isOwnerOnlyTransition('cancelled', 'new')).toBe(true);
  });

  it('обычные переходы не требуют прав владельца', () => {
    expect(isOwnerOnlyTransition('new', 'in_progress')).toBe(false);
    expect(isOwnerOnlyTransition('ready', 'delivered')).toBe(false);
  });

  it('отмена возможна на любом рабочем этапе, но не после выдачи', () => {
    for (const status of ['new', 'pending_approval', 'scheduled', 'in_progress'] as const) {
      expect(canTransition(status, 'cancelled')).toBe(true);
    }
    expect(canTransition('ready', 'cancelled')).toBe(false);
    expect(canTransition('delivered', 'cancelled')).toBe(false);
  });

  it('у каждого статуса описаны допустимые переходы', () => {
    for (const status of Object.keys(ALLOWED_TRANSITIONS)) {
      expect(Array.isArray(allowedFrom(status as keyof typeof ALLOWED_TRANSITIONS))).toBe(true);
    }
  });

  it('переход в работу и выдачу проставляет отметки времени', () => {
    expect(timestampsFor('in_progress').startedAt).toBeInstanceOf(Date);
    expect(timestampsFor('ready').readyAt).toBeInstanceOf(Date);
    expect(timestampsFor('delivered').deliveredAt).toBeInstanceOf(Date);
    // Возврат в «Новый» снимает прежние отметки: иначе история врёт.
    expect(timestampsFor('new').startedAt).toBeNull();
    expect(timestampsFor('new').deliveredAt).toBeNull();
  });

  it('активными считаются все статусы до выдачи', () => {
    expect(ACTIVE_STATUSES).not.toContain('delivered');
    expect(ACTIVE_STATUSES).not.toContain('cancelled');
    expect(ACTIVE_STATUSES).toContain('in_progress');
  });
});
