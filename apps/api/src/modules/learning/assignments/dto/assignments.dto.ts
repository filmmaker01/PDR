import { z } from 'zod';
import { nonEmptyString, optionalString } from '@pdr/shared';

export const updateSubmissionSchema = z.object({ text: optionalString(20_000) }).strict();

export const attachFileSchema = z.object({ fileId: z.string().uuid() }).strict();

export const copyFilesSchema = z.object({ sourceSubmissionId: z.string().uuid() }).strict();

export const reviewSchema = z
  .object({
    decision: z.enum(['accepted', 'returned']),
    comment: nonEmptyString(5000),
    rubric: z.record(z.string().max(60), z.number().int().min(0).max(100)).nullable().optional(),
  })
  .strict();

export const commentSchema = z.object({ body: nonEmptyString(5000) }).strict();

export const queueQuerySchema = z.object({
  cohortId: z.string().uuid().optional(),
  assignmentKey: z.string().max(60).optional(),
  onlyMine: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
