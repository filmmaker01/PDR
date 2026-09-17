import type { WorkspaceRole } from './enums/index.js';

/**
 * Права участника мастерской. Суффикс `?setting` — право действует только
 * при включённой настройке мастерской (workspaces.settings).
 */
export const WORKSPACE_PERMISSIONS = [
  'workspace.read',
  'workspace.manage',
  'members.read',
  'members.manage',
  'clients.read',
  'clients.write',
  'clients.manage',
  'leads.read',
  'leads.write',
  'leads.manage',
  'orders.read_own',
  'orders.read_all',
  'orders.create',
  'orders.write_own',
  'orders.write_all',
  'orders.assign',
  'orders.manage',
  'appointments.read',
  'appointments.write_own',
  'appointments.write_all',
  'appointments.override_overlap',
  'price_list.read',
  'price_list.manage',
  'estimates.read',
  'estimates.write_own',
  'estimates.write_all',
  'payments.read_own',
  'payments.read_all',
  'payments.write_own',
  'payments.write_all',
  'analytics.read',
  'audit.read',
  'export.run',
] as const;

export type WorkspacePermission = (typeof WORKSPACE_PERMISSIONS)[number];

/** Настройки мастерской, влияющие на права сотрудников. */
export interface WorkspacePermissionSettings {
  employees_see_all_orders: boolean;
  employees_can_assign: boolean;
  employees_can_edit_estimates: boolean;
  employees_can_take_payments: boolean;
}

export const DEFAULT_PERMISSION_SETTINGS: WorkspacePermissionSettings = {
  employees_see_all_orders: true,
  employees_can_assign: false,
  employees_can_edit_estimates: true,
  employees_can_take_payments: true,
};

type ConditionalPermission = {
  permission: WorkspacePermission;
  setting: keyof WorkspacePermissionSettings;
};

const OWNER_PERMISSIONS: readonly WorkspacePermission[] = WORKSPACE_PERMISSIONS;

const EMPLOYEE_PERMISSIONS: readonly WorkspacePermission[] = [
  'workspace.read',
  'members.read',
  'clients.read',
  'clients.write',
  'leads.read',
  'leads.write',
  'orders.read_own',
  'orders.create',
  'orders.write_own',
  'appointments.read',
  'appointments.write_own',
  'price_list.read',
  'estimates.read',
  'payments.read_own',
];

const EMPLOYEE_CONDITIONAL: readonly ConditionalPermission[] = [
  { permission: 'orders.read_all', setting: 'employees_see_all_orders' },
  { permission: 'orders.assign', setting: 'employees_can_assign' },
  { permission: 'appointments.write_all', setting: 'employees_can_assign' },
  { permission: 'estimates.write_own', setting: 'employees_can_edit_estimates' },
  { permission: 'payments.write_own', setting: 'employees_can_take_payments' },
];

export function permissionsFor(
  role: WorkspaceRole,
  settings: WorkspacePermissionSettings = DEFAULT_PERMISSION_SETTINGS,
): Set<WorkspacePermission> {
  if (role === 'owner') return new Set(OWNER_PERMISSIONS);
  const set = new Set<WorkspacePermission>(EMPLOYEE_PERMISSIONS);
  for (const { permission, setting } of EMPLOYEE_CONDITIONAL) {
    if (settings[setting]) set.add(permission);
  }
  return set;
}

export function can(
  role: WorkspaceRole,
  permission: WorkspacePermission,
  settings?: WorkspacePermissionSettings,
): boolean {
  return permissionsFor(role, settings).has(permission);
}

/**
 * «Свой» объект для сотрудника: он исполнитель или создатель.
 * Владелец проходит по `*_all`, поэтому сюда не попадает.
 */
export function ownsRecord(
  ctx: { memberId: string; userId: string },
  record: { assigneeMemberId?: string | null; createdBy?: string | null },
): boolean {
  return record.assigneeMemberId === ctx.memberId || record.createdBy === ctx.userId;
}
