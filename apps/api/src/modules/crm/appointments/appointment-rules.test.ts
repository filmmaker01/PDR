import { describe, expect, it } from 'vitest';
import {
  ALLOWED_APPOINTMENT_TRANSITIONS,
  APPOINTMENT_STATUS_LABELS,
  canTransitionAppointment,
  isBlocking,
  isEditable,
  isOwnerOnlyAppointmentTransition,
} from './appointment-rules';

describe('переходы статуса записи', () => {
  it('запланированную запись можно подтвердить, выполнить или отменить', () => {
    expect(canTransitionAppointment('planned', 'confirmed')).toBe(true);
    expect(canTransitionAppointment('planned', 'done')).toBe(true);
    expect(canTransitionAppointment('planned', 'cancelled')).toBe(true);
    expect(canTransitionAppointment('planned', 'no_show')).toBe(true);
  });

  it('из выполненной записи нельзя перейти в отменённую', () => {
    expect(canTransitionAppointment('done', 'cancelled')).toBe(false);
  });

  it('возврат из завершающих статусов доступен только владельцу', () => {
    expect(isOwnerOnlyAppointmentTransition('done', 'confirmed')).toBe(true);
    expect(isOwnerOnlyAppointmentTransition('cancelled', 'planned')).toBe(true);
    expect(isOwnerOnlyAppointmentTransition('no_show', 'planned')).toBe(true);
    expect(isOwnerOnlyAppointmentTransition('planned', 'done')).toBe(false);
  });

  it('время исполнителя занимают только запланированные и подтверждённые', () => {
    expect(isBlocking('planned')).toBe(true);
    expect(isBlocking('confirmed')).toBe(true);
    expect(isBlocking('cancelled')).toBe(false);
    expect(isBlocking('done')).toBe(false);
    expect(isBlocking('no_show')).toBe(false);
  });

  it('переносить можно только незавершённые записи', () => {
    expect(isEditable('planned')).toBe(true);
    expect(isEditable('done')).toBe(false);
  });

  it('у каждого статуса есть название и список переходов', () => {
    for (const status of Object.keys(ALLOWED_APPOINTMENT_TRANSITIONS)) {
      expect(APPOINTMENT_STATUS_LABELS[status as 'planned']).toBeTruthy();
    }
  });
});
