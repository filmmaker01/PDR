import type { Workspace, WorkspaceMember, WorkspaceRole } from '@prisma/client';
import { DEFAULT_PRICE_COEFFICIENT } from '@pdr/shared';
import type { WorkspacePermission, WorkspacePermissionSettings } from '@pdr/shared';

/**
 * Контекст мастерской. Кладётся в запрос guard'ом и обязателен
 * для любого обращения к данным CRM.
 */
export interface WorkspaceContext {
  workspaceId: string;
  workspace: Workspace;
  member: WorkspaceMember;
  role: WorkspaceRole;
  userId: string;
  settings: WorkspaceSettings;
  permissions: Set<WorkspacePermission>;
  /** Доступ к CRM действует: при false разрешено только чтение и экспорт. */
  hasActiveAccess: boolean;
  accessValidUntil: Date | null;
}

export interface WorkspaceSettings extends WorkspacePermissionSettings {
  /** Рабочие часы для календаря, локальное время мастерской. */
  work_day_start: string;
  work_day_end: string;
  default_appointment_minutes: number;
  /** За сколько минут напоминать о записи. */
  reminder_lead_minutes: number;
  /**
   * Коэффициент стоимости по умолчанию, в процентах. Подставляется в новую
   * оценку и меняется в ней для конкретного случая: настройка задаёт привычку
   * мастерской, а не запрет.
   */
  default_price_coefficient: number;
  /**
   * Реквизиты для печатных документов. Название и строки реквизитов правятся
   * в настройках, чтобы менять их без правки шаблонов: юридическое лицо,
   * ИНН, расчётный счёт у мастерских разные и со временем меняются.
   */
  document_legal_name?: string;
  document_requisites?: string;
}

export const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettings = {
  employees_see_all_orders: true,
  employees_can_assign: false,
  employees_can_edit_estimates: true,
  employees_can_take_payments: true,
  work_day_start: '09:00',
  work_day_end: '20:00',
  default_appointment_minutes: 60,
  reminder_lead_minutes: 60,
  default_price_coefficient: DEFAULT_PRICE_COEFFICIENT,
};
