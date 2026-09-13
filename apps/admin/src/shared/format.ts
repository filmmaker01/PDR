export function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium' }).format(new Date(iso));
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso),
  );
}

export const PRODUCT_LABELS: Record<string, string> = {
  course: 'Курс',
  crm: 'CRM',
  club: 'Клуб',
};

export const GRANT_STATUS_LABELS: Record<string, string> = {
  active: 'Действует',
  expired: 'Истёк',
  revoked: 'Отозван',
  suspended: 'Приостановлен',
};

export const GRANT_STATUS_COLORS: Record<string, string> = {
  active: 'green',
  expired: 'gray',
  revoked: 'red',
  suspended: 'yellow',
};

export function daysLeft(validUntil: string | null): number | null {
  if (!validUntil) return null;
  return Math.ceil((new Date(validUntil).getTime() - Date.now()) / 86_400_000);
}
