import { z } from 'zod';
import { nonEmptyString, optionalString, timezoneSchema } from '@pdr/shared';

export const createGrantSchema = z
  .object({
    product: z.enum(['course', 'crm', 'club']),
    userId: z.string().uuid().optional(),
    workspaceId: z.string().uuid().optional(),
    courseId: z.string().uuid().optional(),
    validFrom: z.coerce.date().optional(),
    validUntil: z.coerce.date().nullable().optional(),
    source: z.enum(['manual', 'promo', 'migration', 'payment']).default('manual'),
    externalRef: optionalString(120),
    reason: optionalString(500),
  })
  .strict();

export const extendGrantSchema = z
  .object({
    validUntil: z.coerce.date().nullable(),
    reason: nonEmptyString(500),
  })
  .strict();

export const revokeGrantSchema = z.object({ reason: nonEmptyString(500) }).strict();

export const listGrantsQuerySchema = z.object({
  product: z.enum(['course', 'crm', 'club']).optional(),
  status: z.enum(['active', 'expired', 'revoked', 'suspended']).optional(),
  userId: z.string().uuid().optional(),
  workspaceId: z.string().uuid().optional(),
  expiringInDays: z.coerce.number().int().min(1).max(365).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});

export const createWorkspaceSchema = z
  .object({
    name: nonEmptyString(120),
    ownerUserId: z.string().uuid(),
    timezone: timezoneSchema.default('Europe/Moscow'),
    currency: z.string().length(3).default('RUB'),
  })
  .strict();

export const userSearchQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const platformRoleSchema = z.object({ role: z.enum(['admin', 'curator']) }).strict();

export const banUserSchema = z.object({ reason: nonEmptyString(300) }).strict();
