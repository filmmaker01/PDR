import type { Workspace, WorkspaceMember, WorkspaceRole } from '@prisma/client';
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
  settings: WorkspacePermissionSettings;
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
};
