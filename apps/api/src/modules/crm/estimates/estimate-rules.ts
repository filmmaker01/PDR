import type { EstimateStatus } from '@prisma/client';

/** Статусы, в которых смету ещё можно править. */
export const EDITABLE_ESTIMATE_STATUSES: readonly EstimateStatus[] = ['draft', 'sent'];

/** Статусы, из которых имеет смысл делать новую версию. */
export const VERSIONABLE_STATUSES: readonly EstimateStatus[] = ['sent', 'agreed', 'rejected'];

export const ALLOWED_ESTIMATE_TRANSITIONS: Record<EstimateStatus, EstimateStatus[]> = {
  draft: ['sent', 'agreed'],
  sent: ['agreed', 'rejected', 'superseded'],
  // Согласованная смета заменяется только согласованием следующей версии.
  agreed: ['superseded'],
  rejected: ['superseded'],
  superseded: [],
};

export const ESTIMATE_STATUS_LABELS: Record<EstimateStatus, string> = {
  draft: 'Черновик',
  sent: 'Отправлена клиенту',
  agreed: 'Согласована',
  rejected: 'Отклонена',
  superseded: 'Заменена',
};

export function isEstimateEditable(status: EstimateStatus): boolean {
  return EDITABLE_ESTIMATE_STATUSES.includes(status);
}

export function canVersion(status: EstimateStatus): boolean {
  return VERSIONABLE_STATUSES.includes(status);
}

export function canTransitionEstimate(from: EstimateStatus, to: EstimateStatus): boolean {
  return ALLOWED_ESTIMATE_TRANSITIONS[from].includes(to);
}

/**
 * Создание новой версии из отправленной или отклонённой сметы отменяет её:
 * прежнее предложение больше не действует. Согласованная смета остаётся
 * действующей, пока не согласована следующая версия, — иначе у заказа
 * пропала бы согласованная сумма.
 */
export function supersedesSourceOnNewVersion(status: EstimateStatus): boolean {
  return status === 'sent' || status === 'rejected';
}
