import { z } from 'zod';
import { nonEmptyString } from '@pdr/shared';

export const saveAnswerSchema = z
  .object({
    selectedOptionIds: z.array(z.string().uuid()).max(20).optional(),
    textAnswer: z.string().trim().max(1000).nullable().optional(),
  })
  .strict();

export const attachAttemptFileSchema = z.object({ fileId: z.string().uuid() }).strict();

export const gradePracticalSchema = z
  .object({
    score: z.number().int().min(0).max(100),
    comment: nonEmptyString(5000),
  })
  .strict();

export const cancelAttemptSchema = z.object({ reason: nonEmptyString(500) }).strict();
