import type { OrderStatus } from '@prisma/client';

/**
 * Разрешённые переходы статуса заказа.
 * Всё, чего здесь нет, сервер отклоняет: история заказа должна быть
 * восстановимой, а не набором произвольных состояний.
 */
export const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  new: ['pending_approval', 'scheduled', 'in_progress', 'cancelled'],
  pending_approval: ['scheduled', 'in_progress', 'new', 'cancelled'],
  scheduled: ['in_progress', 'pending_approval', 'cancelled'],
  in_progress: ['ready', 'scheduled', 'cancelled'],
  ready: ['delivered', 'in_progress'],
  // Возврат выданного заказа и возобновление отменённого — действия владельца.
  delivered: ['ready'],
  cancelled: ['new'],
};

/** Переходы, доступные только владельцу мастерской. */
export const OWNER_ONLY_TRANSITIONS: { from: OrderStatus; to: OrderStatus }[] = [
  { from: 'delivered', to: 'ready' },
  { from: 'cancelled', to: 'new' },
];

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  new: 'Новый',
  pending_approval: 'На согласовании',
  scheduled: 'Запланирован',
  in_progress: 'В работе',
  ready: 'Готов',
  delivered: 'Выдан',
  cancelled: 'Отменён',
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function isOwnerOnlyTransition(from: OrderStatus, to: OrderStatus): boolean {
  return OWNER_ONLY_TRANSITIONS.some((t) => t.from === from && t.to === to);
}

export function allowedFrom(from: OrderStatus): OrderStatus[] {
  return ALLOWED_TRANSITIONS[from];
}

/** Отметки времени, которые ставит переход. */
export function timestampsFor(to: OrderStatus): Record<string, Date | null> {
  const now = new Date();
  switch (to) {
    case 'in_progress':
      return { startedAt: now, cancelledAt: null };
    case 'ready':
      return { readyAt: now, deliveredAt: null };
    case 'delivered':
      return { deliveredAt: now };
    case 'cancelled':
      return { cancelledAt: now };
    case 'new':
      return { cancelledAt: null, startedAt: null, readyAt: null, deliveredAt: null };
    default:
      return {};
  }
}

/** Статусы, при которых заказ считается активным (в работе у мастерской). */
export const ACTIVE_STATUSES: OrderStatus[] = [
  'new',
  'pending_approval',
  'scheduled',
  'in_progress',
  'ready',
];
