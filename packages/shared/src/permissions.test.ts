import { describe, expect, it } from 'vitest';
import { DEFAULT_PERMISSION_SETTINGS, can, ownsRecord, permissionsFor } from './permissions.js';

describe('permissionsFor', () => {
  it('owner has every permission', () => {
    expect(permissionsFor('owner').size).toBeGreaterThan(25);
    expect(can('owner', 'analytics.read')).toBe(true);
    expect(can('owner', 'appointments.override_overlap')).toBe(true);
  });

  it('employee never gets owner-only permissions regardless of settings', () => {
    const permissive = {
      employees_see_all_orders: true,
      employees_can_assign: true,
      employees_can_edit_estimates: true,
      employees_can_take_payments: true,
    };
    for (const p of [
      'analytics.read',
      'audit.read',
      'export.run',
      'members.manage',
      'workspace.manage',
      'price_list.manage',
      'appointments.override_overlap',
      'clients.manage',
      'orders.manage',
    ] as const) {
      expect(can('employee', p, permissive)).toBe(false);
    }
  });

  it('conditional permissions follow workspace settings', () => {
    const off = {
      ...DEFAULT_PERMISSION_SETTINGS,
      employees_can_take_payments: false,
      employees_see_all_orders: false,
    };
    expect(can('employee', 'payments.write_own', off)).toBe(false);
    expect(can('employee', 'orders.read_all', off)).toBe(false);
    expect(can('employee', 'payments.write_own', DEFAULT_PERMISSION_SETTINGS)).toBe(true);
    expect(can('employee', 'orders.read_all', DEFAULT_PERMISSION_SETTINGS)).toBe(true);
  });

  it('employee can always work with own orders and clients', () => {
    expect(can('employee', 'orders.write_own')).toBe(true);
    expect(can('employee', 'clients.write')).toBe(true);
  });
});

describe('ownsRecord', () => {
  const ctx = { memberId: 'm1', userId: 'u1' };
  it('true for assignee', () => {
    expect(ownsRecord(ctx, { assigneeMemberId: 'm1', createdBy: 'u9' })).toBe(true);
  });
  it('true for creator', () => {
    expect(ownsRecord(ctx, { assigneeMemberId: 'm9', createdBy: 'u1' })).toBe(true);
  });
  it('false otherwise', () => {
    expect(ownsRecord(ctx, { assigneeMemberId: 'm9', createdBy: 'u9' })).toBe(false);
    expect(ownsRecord(ctx, { assigneeMemberId: null, createdBy: null })).toBe(false);
  });
});
