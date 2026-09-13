import { z } from 'zod';
import { ORDER_STATUSES, nonEmptyString, optionalString } from '@pdr/shared';

export const clientListQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  archived: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});

export const createClientSchema = z
  .object({
    name: nonEmptyString(200),
    phone: optionalString(32),
    phoneExtra: optionalString(32),
    telegramUsername: optionalString(64),
    source: optionalString(120),
    notes: optionalString(4000),
    tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  })
  .strict();

export const updateClientSchema = createClientSchema.partial().strict();

export const createVehicleSchema = z
  .object({
    make: nonEmptyString(60),
    model: nonEmptyString(60),
    year: z.number().int().min(1900).max(2100).nullable().optional(),
    color: optionalString(40),
    plate: optionalString(20),
    vin: optionalString(20),
    bodyType: optionalString(40),
    notes: optionalString(2000),
  })
  .strict();

export const updateVehicleSchema = createVehicleSchema
  .partial()
  .extend({ archived: z.boolean().optional() })
  .strict();

export const orderListQuerySchema = z.object({
  status: z
    .union([z.enum(ORDER_STATUSES), z.array(z.enum(ORDER_STATUSES))])
    .optional()
    .transform((v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v])),
  assigneeMemberId: z.string().uuid().optional(),
  paymentStatus: z.enum(['unpaid', 'partial', 'paid', 'overpaid']).optional(),
  q: z.string().trim().max(120).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  archived: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});

export const createOrderSchema = z
  .object({
    clientId: z.string().uuid().optional(),
    newClient: z
      .object({ name: nonEmptyString(200), phone: optionalString(32) })
      .strict()
      .optional(),
    vehicleId: z.string().uuid().optional(),
    newVehicle: z
      .object({
        make: nonEmptyString(60),
        model: nonEmptyString(60),
        plate: optionalString(20),
        year: z.number().int().min(1900).max(2100).nullable().optional(),
        color: optionalString(40),
      })
      .strict()
      .optional(),
    title: optionalString(300),
    damageSummary: optionalString(4000),
    assigneeMemberId: z.string().uuid().nullable().optional(),
    internalNotes: optionalString(4000),
  })
  .strict()
  .refine((v) => Boolean(v.clientId || v.newClient), {
    message: 'Выберите клиента или создайте нового',
  });

export const updateOrderSchema = z
  .object({
    title: optionalString(300),
    damageSummary: optionalString(4000),
    internalNotes: optionalString(4000),
    clientNotes: optionalString(4000),
    vehicleId: z.string().uuid().nullable().optional(),
    assigneeMemberId: z.string().uuid().nullable().optional(),
  })
  .strict();

export const transitionSchema = z
  .object({
    to: z.enum(ORDER_STATUSES),
    comment: optionalString(1000),
  })
  .strict();

export const archiveSchema = z.object({ archived: z.boolean() }).strict();
