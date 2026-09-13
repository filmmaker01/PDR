import { z } from 'zod';
import { FILE_SCOPES } from '@pdr/shared';

export const presignUploadSchema = z
  .object({
    scope: z.enum(FILE_SCOPES),
    mimeType: z.string().min(3).max(120),
    sizeBytes: z.number().int().positive(),
    originalName: z.string().max(255).nullable().optional(),
    workspaceId: z.string().uuid().nullable().optional(),
  })
  .strict();

export const completeUploadSchema = z
  .object({
    parts: z
      .array(z.object({ partNumber: z.number().int().positive(), etag: z.string().min(1) }))
      .max(10_000)
      .optional(),
  })
  .strict();

export const downloadQuerySchema = z.object({
  variant: z.enum(['original', 'thumb', 'preview']).default('original'),
});
