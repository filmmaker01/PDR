import { z } from 'zod';
import {
  ACCESS_DIFFICULTIES,
  APPOINTMENT_KINDS,
  APPOINTMENT_STATUSES,
  DISCOUNT_KINDS,
  ESTIMATE_ITEM_KINDS,
  MATERIALS,
  ORDER_STATUSES,
  PAYMENT_KINDS,
  PAYMENT_METHODS,
  PAYMENT_PURPOSES,
  PHOTO_CATEGORIES,
  PRICE_UNITS,
  nonEmptyString,
  optionalString,
} from '@pdr/shared';

/** Локальное время мастерской: `YYYY-MM-DDTHH:mm`. */
const localDateTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/, 'Ожидается время в формате 2026-05-01T09:30');

const dayIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ожидается дата в формате 2026-05-01');

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

export const mergeClientsSchema = z.object({ sourceClientId: z.string().uuid() }).strict();

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
    /** Запись в календарь создаётся вместе с заказом. */
    appointment: z
      .object({
        startsAtLocal: localDateTime,
        durationMin: z.number().int().min(15).max(600),
        kind: z.enum(APPOINTMENT_KINDS).default('inspection'),
        note: optionalString(1000),
        allowOverlap: z.boolean().optional(),
      })
      .strict()
      .optional(),
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

// ── Календарь и записи ───────────────────────────────────────────────────────

export const appointmentRangeQuerySchema = z
  .object({
    from: z.coerce.date(),
    to: z.coerce.date(),
    assigneeMemberId: z.string().uuid().optional(),
    status: z
      .union([z.enum(APPOINTMENT_STATUSES), z.array(z.enum(APPOINTMENT_STATUSES))])
      .optional()
      .transform((v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v])),
  })
  .strict();

export const createAppointmentSchema = z
  .object({
    orderId: z.string().uuid().nullable().optional(),
    clientId: z.string().uuid().nullable().optional(),
    assigneeMemberId: z.string().uuid().nullable().optional(),
    startsAtLocal: localDateTime,
    durationMin: z.number().int().min(15).max(600),
    kind: z.enum(APPOINTMENT_KINDS).default('repair'),
    title: optionalString(200),
    note: optionalString(1000),
    allowOverlap: z.boolean().optional(),
  })
  .strict();

export const updateAppointmentSchema = z
  .object({
    startsAtLocal: localDateTime.optional(),
    durationMin: z.number().int().min(15).max(600).optional(),
    assigneeMemberId: z.string().uuid().nullable().optional(),
    kind: z.enum(APPOINTMENT_KINDS).optional(),
    title: optionalString(200),
    note: optionalString(1000),
    allowOverlap: z.boolean().optional(),
  })
  .strict();

export const appointmentStatusSchema = z
  .object({
    to: z.enum(APPOINTMENT_STATUSES),
    reason: optionalString(500),
  })
  .strict();

export const availabilityQuerySchema = z
  .object({
    day: dayIso,
    assigneeMemberId: z.string().uuid().optional(),
    durationMin: z.coerce.number().int().min(15).max(600).optional(),
    stepMin: z.coerce.number().int().min(5).max(240).optional(),
    excludeId: z.string().uuid().optional(),
  })
  .strict();

// ── Прайс и сметы ────────────────────────────────────────────────────────────

export const priceListItemSchema = z
  .object({
    kind: z.enum(ESTIMATE_ITEM_KINDS).default('damage'),
    title: nonEmptyString(200),
    panelCode: optionalString(40),
    damageType: optionalString(40),
    sizeClass: z.enum(['S', 'M', 'L', 'XL']).nullable().optional(),
    unitPriceMinor: z.number().int().min(0).max(100_000_000),
    unit: z.enum(PRICE_UNITS).default('per_item'),
    isActive: z.boolean().optional(),
  })
  .strict();

export const updatePriceListItemSchema = priceListItemSchema.partial().strict();

export const reorderPriceListSchema = z
  .object({ ids: z.array(z.string().uuid()).min(1).max(500) })
  .strict();

export const createEstimateSchema = z
  .object({ fromEstimateId: z.string().uuid().nullable().optional() })
  .strict();

export const estimateSettingsSchema = z
  .object({
    discountKind: z.enum(DISCOUNT_KINDS).optional(),
    discountValue: z.number().int().min(0).max(100_000_000).optional(),
    noteForClient: optionalString(2000),
    internalNote: optionalString(2000),
  })
  .strict();

export const estimateItemsSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            kind: z.enum(ESTIMATE_ITEM_KINDS).optional(),
            title: optionalString(200),
            panelCode: optionalString(40),
            damageType: optionalString(40),
            sizeClass: z.enum(['S', 'M', 'L', 'XL']).nullable().optional(),
            quantity: z.number().int().min(1).max(1000).default(1),
            material: z.enum(MATERIALS).nullable().optional(),
            accessDifficulty: z.enum(ACCESS_DIFFICULTIES).nullable().optional(),
            onEdge: z.boolean().optional(),
            unitPriceMinor: z.number().int().min(0).max(100_000_000).optional(),
            priceListItemId: z.string().uuid().nullable().optional(),
            comment: optionalString(500),
          })
          .strict(),
      )
      .max(300),
  })
  .strict();

export const rejectEstimateSchema = z.object({ reason: optionalString(500) }).strict();

// ── Оплаты и фото ────────────────────────────────────────────────────────────

export const createPaymentSchema = z
  .object({
    kind: z.enum(PAYMENT_KINDS).default('payment'),
    amountMinor: z.number().int().min(1).max(1_000_000_000),
    method: z.enum(PAYMENT_METHODS).default('cash'),
    purpose: z.enum(PAYMENT_PURPOSES).optional(),
    occurredAt: z.coerce.date().optional(),
    note: optionalString(500),
    correctsEntryId: z.string().uuid().nullable().optional(),
  })
  .strict();

export const paymentJournalQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  method: z.enum(PAYMENT_METHODS).optional(),
  createdById: z.string().uuid().optional(),
  orderId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  cursor: z.string().optional(),
});

export const attachPhotoSchema = z
  .object({
    fileId: z.string().uuid(),
    category: z.enum(PHOTO_CATEGORIES).default('before'),
    estimateItemId: z.string().uuid().nullable().optional(),
    caption: optionalString(200),
  })
  .strict();

export const updatePhotoSchema = z
  .object({
    category: z.enum(PHOTO_CATEGORIES).optional(),
    caption: optionalString(200),
    position: z.number().int().min(0).max(10_000).optional(),
    estimateItemId: z.string().uuid().nullable().optional(),
  })
  .strict();
