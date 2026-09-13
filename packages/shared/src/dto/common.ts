import { z } from 'zod';

export const uuidSchema = z.string().uuid();
export const cursorSchema = z.string().min(1).max(500);

export const paginationSchema = z.object({
  cursor: cursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type Pagination = z.infer<typeof paginationSchema>;

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export const idempotencyKeySchema = z.string().uuid();

/** Локальное время мастерской без зоны: YYYY-MM-DDTHH:mm(:ss). */
export const localDateTimeSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/, 'Ожидается формат YYYY-MM-DDTHH:mm');

export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ожидается формат YYYY-MM-DD');

export const moneyMinorSchema = z.number().int();
export const positiveMoneyMinorSchema = z.number().int().positive();
export const currencySchema = z.string().length(3).toUpperCase();

export const timezoneSchema = z.string().min(1).max(64);

export const nonEmptyString = (max = 500) => z.string().trim().min(1).max(max);
export const optionalString = (max = 500) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();
