import { z } from 'zod';

export const notificationPreferencesSchema = z
  .object({
    reviewResults: z.boolean().optional(),
    stageUnlocked: z.boolean().optional(),
    appointmentReminders: z.boolean().optional(),
    orderAssigned: z.boolean().optional(),
    accessExpiring: z.boolean().optional(),
    reviewQueueDigest: z.boolean().optional(),
    reminderLeadMinutes: z.number().int().min(0).max(1440).optional(),
  })
  .strict();
