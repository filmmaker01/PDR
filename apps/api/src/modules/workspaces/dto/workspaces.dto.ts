import { z } from 'zod';
import { nonEmptyString, optionalString, timezoneSchema } from '@pdr/shared';

export const workspaceSettingsSchema = z
  .object({
    employees_see_all_orders: z.boolean(),
    employees_can_assign: z.boolean(),
    employees_can_edit_estimates: z.boolean(),
    employees_can_take_payments: z.boolean(),
    work_day_start: z.string().regex(/^\d{2}:\d{2}$/),
    work_day_end: z.string().regex(/^\d{2}:\d{2}$/),
    default_appointment_minutes: z.number().int().min(15).max(600),
    reminder_lead_minutes: z.number().int().min(0).max(1440),
  })
  .partial()
  .strict();

export const updateWorkspaceSchema = z
  .object({
    name: nonEmptyString(120).optional(),
    timezone: timezoneSchema.optional(),
    phone: optionalString(32),
    address: optionalString(300),
    settings: workspaceSettingsSchema.optional(),
  })
  .strict();

export const createWorkspaceSchema = z
  .object({
    name: nonEmptyString(120),
    ownerUserId: z.string().uuid(),
    timezone: timezoneSchema.default('Europe/Moscow'),
    currency: z.string().length(3).default('RUB'),
  })
  .strict();

export const updateMemberSchema = z
  .object({
    displayName: optionalString(80),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, 'Ожидается цвет в формате #RRGGBB')
      .nullable()
      .optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export const createInvitationSchema = z
  .object({
    role: z.literal('employee').default('employee'),
    expiresInDays: z.number().int().min(1).max(30).default(7),
    phone: optionalString(32),
    note: optionalString(200),
  })
  .strict();

export const acceptInvitationSchema = z.object({ token: z.string().min(10).max(200) }).strict();

export const transferOwnershipSchema = z.object({ memberId: z.string().uuid() }).strict();
