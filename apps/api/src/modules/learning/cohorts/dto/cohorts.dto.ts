import { z } from 'zod';
import { nonEmptyString, optionalString } from '@pdr/shared';

export const createCohortSchema = z
  .object({
    courseId: z.string().uuid(),
    courseVersionId: z.string().uuid().optional(),
    title: nonEmptyString(200),
    unlockMode: z.enum(['interval', 'dates']).default('interval'),
    startsAt: z.coerce.date(),
    stageDates: z.record(z.string(), z.string().datetime()).nullable().optional(),
  })
  .strict();

export const updateCohortSchema = z
  .object({
    title: nonEmptyString(200).optional(),
    unlockMode: z.enum(['interval', 'dates']).optional(),
    startsAt: z.coerce.date().optional(),
    stageDates: z.record(z.string(), z.string().datetime()).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export const enrollSchema = z
  .object({
    userId: z.string().uuid(),
    startedAt: z.coerce.date().optional(),
    grantValidUntil: z.coerce.date().nullable().optional(),
    reason: optionalString(300),
  })
  .strict();

export const bulkEnrollSchema = z
  .object({
    userIds: z.array(z.string().uuid()).min(1).max(200),
    startedAt: z.coerce.date().optional(),
    grantValidUntil: z.coerce.date().nullable().optional(),
  })
  .strict();

export const updateEnrollmentSchema = z
  .object({
    status: z.enum(['active', 'paused', 'withdrawn', 'completed']).optional(),
    startedAt: z.coerce.date().optional(),
    note: optionalString(1000),
  })
  .strict();

export const migrateSchema = z
  .object({ courseVersionId: z.string().uuid(), dryRun: z.boolean().default(true) })
  .strict();

export const overrideSchema = z
  .object({
    stageKey: z.string().min(1).max(60),
    action: z.enum(['unlock', 'lock']),
    reason: nonEmptyString(500),
    expiresAt: z.coerce.date().nullable().optional(),
  })
  .strict();

export const curatorSchema = z.object({ userId: z.string().uuid() }).strict();

export const transferSchema = z.object({ cohortId: z.string().uuid() }).strict();
