import type { AppointmentStatus } from '@prisma/client';

/** Статусы, при которых запись занимает время исполнителя. */
export const BLOCKING_STATUSES: readonly AppointmentStatus[] = ['planned', 'confirmed'];

/** Статусы, которые ещё можно переносить и редактировать. */
export const EDITABLE_STATUSES: readonly AppointmentStatus[] = ['planned', 'confirmed'];

export const ALLOWED_APPOINTMENT_TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  planned: ['confirmed', 'done', 'cancelled', 'no_show'],
  confirmed: ['done', 'cancelled', 'no_show', 'planned'],
  // Возврат из завершённого состояния — исправление ошибки, только владельцем.
  done: ['confirmed'],
  cancelled: ['planned'],
  no_show: ['planned'],
};

/** Исправления задним числом доступны только владельцу мастерской. */
export const OWNER_ONLY_APPOINTMENT_TRANSITIONS: readonly {
  from: AppointmentStatus;
  to: AppointmentStatus;
}[] = [
  { from: 'done', to: 'confirmed' },
  { from: 'cancelled', to: 'planned' },
  { from: 'no_show', to: 'planned' },
];

export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
  planned: 'Запланирована',
  confirmed: 'Подтверждена',
  done: 'Выполнена',
  cancelled: 'Отменена',
  no_show: 'Клиент не приехал',
};

export const APPOINTMENT_KIND_LABELS: Record<string, string> = {
  inspection: 'Осмотр',
  repair: 'Ремонт',
  delivery: 'Выдача',
  other: 'Другое',
};

export function canTransitionAppointment(from: AppointmentStatus, to: AppointmentStatus): boolean {
  return ALLOWED_APPOINTMENT_TRANSITIONS[from].includes(to);
}

export function isOwnerOnlyAppointmentTransition(
  from: AppointmentStatus,
  to: AppointmentStatus,
): boolean {
  return OWNER_ONLY_APPOINTMENT_TRANSITIONS.some((t) => t.from === from && t.to === to);
}

export function isBlocking(status: AppointmentStatus): boolean {
  return BLOCKING_STATUSES.includes(status);
}

export function isEditable(status: AppointmentStatus): boolean {
  return EDITABLE_STATUSES.includes(status);
}
