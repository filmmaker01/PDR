import { z } from 'zod';
import {
  ACCESS_DIFFICULTIES,
  APPOINTMENT_KINDS,
  ASSESSMENT_METHODS,
  isKnownSizeClass,
  LEAD_CHANNELS,
  LEAD_SOURCES,
  LEAD_STATUSES,
  MATERIALS,
  PHOTO_CATEGORIES,
  PRICE_COEFFICIENT_MAX,
  PRICE_COEFFICIENT_MIN,
  PRICE_COEFFICIENT_STEP,
  nonEmptyString,
  optionalString,
} from '@pdr/shared';

/** Локальное время мастерской: `YYYY-MM-DDTHH:mm`. */
const localDateTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/, 'Ожидается время в формате 2026-05-01T09:30');

const contactFields = {
  clientId: z.string().uuid().nullable().optional(),
  contactName: optionalString(200),
  contactPhone: optionalString(32),
  contactExtra: optionalString(200),
};

const vehicleFields = {
  vehicleId: z.string().uuid().nullable().optional(),
  vehicleMake: optionalString(60),
  vehicleModel: optionalString(60),
  vehiclePlate: optionalString(20),
  vehicleYear: z.number().int().min(1900).max(2100).nullable().optional(),
  vehicleColor: optionalString(40),
};

/**
 * Размерный класс: код из сетки мастерской. Именно код, а не свободная строка —
 * к нему привязаны цены прайса, и опечатка означала бы нулевую цену.
 */
export const sizeClassSchema = z
  .string()
  .max(20)
  .refine(isKnownSizeClass, { message: 'Неизвестный размерный класс' });

/** Габариты области повреждения в миллиметрах: 40×40 см — это 400×400. */
const damageFields = {
  panelCode: nonEmptyString(40),
  damageType: optionalString(40),
  sizeClass: sizeClassSchema.nullable().optional(),
  widthMm: z.number().int().min(1).max(5000).nullable().optional(),
  heightMm: z.number().int().min(1).max(5000).nullable().optional(),
  quantity: z.number().int().min(1).max(500).optional(),
  material: z.enum(MATERIALS).nullable().optional(),
  accessDifficulty: z.enum(ACCESS_DIFFICULTIES).nullable().optional(),
  onEdge: z.boolean().optional(),
  comment: optionalString(500),
};

/**
 * Повреждение так, как его присылает карточка на схеме кузова.
 *
 * Отдельно от `damageFields`, потому что те же поля идут в позиции оценки,
 * где цена называется иначе. Одна форма на оба входа — отдельный маршрут и
 * массив внутри обращения: иначе форма, собранная для одного, отлетает
 * на другом с 422.
 */
const damageInputFields = {
  ...damageFields,
  /** Мастер мог назвать цену сразу при осмотре, не дожидаясь оценки. */
  priceMinor: z.number().int().min(0).max(100_000_000).nullable().optional(),
  /**
   * Арматурные работы этой детали: снятие обшивки, разбор двери, снятие фары.
   * Присылаются набором целиком — таким, каким мастер видит его на экране.
   */
  extraWorks: z
    .array(
      z
        .object({
          priceListItemId: z.string().uuid().nullable().optional(),
          title: optionalString(200),
          quantity: z.number().int().min(1).max(100).optional(),
          unitPriceMinor: z.number().int().min(0).max(100_000_000).nullable().optional(),
        })
        .strict()
        .refine((v) => Boolean(v.priceListItemId || v.title), {
          message: 'Выберите арматурную работу из справочника или назовите свою',
        }),
    )
    .max(12)
    .optional(),
};

// ── Обращения ────────────────────────────────────────────────────────────────

export const leadListQuerySchema = z.object({
  status: z
    .union([z.enum(LEAD_STATUSES), z.array(z.enum(LEAD_STATUSES))])
    .optional()
    .transform((v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v])),
  source: z.enum(LEAD_SOURCES).optional(),
  channel: z.enum(LEAD_CHANNELS).optional(),
  assigneeMemberId: z.string().uuid().optional(),
  q: z.string().trim().max(120).optional(),
  due: z.coerce.boolean().optional(),
  archived: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});

export const createLeadSchema = z
  .object({
    ...contactFields,
    ...vehicleFields,
    source: z.enum(LEAD_SOURCES).optional(),
    channel: z.enum(LEAD_CHANNELS).nullable().optional(),
    comment: optionalString(4000),
    nextContactAt: z.coerce.date().nullable().optional(),
    assigneeMemberId: z.string().uuid().nullable().optional(),
    /**
     * Повреждения, отмеченные на схеме кузова прямо в форме обращения.
     * Присылаются вместе с обращением, чтобы мастер не сохранял черновик
     * и не открывал вторую форму.
     */
    damages: z.array(z.object(damageInputFields).strict()).max(60).optional(),
    /** Уже загруженные снимки: привязываются к обращению в той же операции. */
    photos: z
      .array(
        z
          .object({
            fileId: z.string().uuid(),
            category: z.enum(PHOTO_CATEGORIES).default('before'),
            caption: optionalString(200),
            /** Номер повреждения в массиве damages, начиная с нуля. */
            damageIndex: z.number().int().min(0).max(59).nullable().optional(),
          })
          .strict(),
      )
      .max(30)
      .optional(),
  })
  .strict()
  .refine((v) => Boolean(v.clientId || v.contactName || v.contactPhone || v.contactExtra), {
    message: 'Укажите, кто обратился: имя, телефон или контакт',
  });

export const updateLeadSchema = z
  .object({
    ...contactFields,
    ...vehicleFields,
    source: z.enum(LEAD_SOURCES).optional(),
    channel: z.enum(LEAD_CHANNELS).nullable().optional(),
    comment: optionalString(4000),
    nextContactAt: z.coerce.date().nullable().optional(),
    assigneeMemberId: z.string().uuid().nullable().optional(),
  })
  .strict();

export const leadTransitionSchema = z
  .object({
    to: z.enum(LEAD_STATUSES),
    comment: optionalString(1000),
    nextContactAt: z.coerce.date().nullable().optional(),
  })
  .strict();

export const leadScheduleSchema = z
  .object({
    startsAtLocal: localDateTime,
    durationMin: z.number().int().min(15).max(600),
    kind: z.enum(APPOINTMENT_KINDS).default('inspection'),
    note: optionalString(1000),
    allowOverlap: z.boolean().optional(),
    assigneeMemberId: z.string().uuid().nullable().optional(),
  })
  .strict();

export const leadConvertSchema = z
  .object({
    title: optionalString(300),
    assigneeMemberId: z.string().uuid().nullable().optional(),
    internalNotes: optionalString(4000),
    appointment: z
      .object({
        startsAtLocal: localDateTime,
        durationMin: z.number().int().min(15).max(600),
        kind: z.enum(APPOINTMENT_KINDS).default('repair'),
        note: optionalString(1000),
        allowOverlap: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const leadArchiveSchema = z.object({ archived: z.boolean() }).strict();

// ── Повреждения ──────────────────────────────────────────────────────────────

export const createDamageSchema = z.object(damageInputFields).strict();

export const updateDamageSchema = z
  .object({ ...damageInputFields, panelCode: optionalString(40) })
  .strict();

// ── Оценки ───────────────────────────────────────────────────────────────────

const assessmentItemSchema = z
  .object({
    damageId: z.string().uuid().nullable().optional(),
    ...damageFields,
    /** Цена за единицу, введённая мастером. Перебивает расчёт. */
    unitPriceMinor: z.number().int().min(0).max(100_000_000).nullable().optional(),
  })
  .strict();

/**
 * Арматурная работа в оценке: снятие обшивки, разбор двери, снятие фары.
 * Цена берётся из справочника мастерской, но правится вручную для конкретного
 * случая — как и цена самого PDR-ремонта.
 */
const assessmentExtraSchema = z
  .object({
    priceListItemId: z.string().uuid().nullable().optional(),
    /** Повреждение, к которому относится работа: по нему считается итог по детали. */
    damageId: z.string().uuid().nullable().optional(),
    title: optionalString(200),
    quantity: z.number().int().min(1).max(100).optional(),
    unitPriceMinor: z.number().int().min(0).max(100_000_000).nullable().optional(),
    comment: optionalString(500),
  })
  .strict()
  .refine((v) => Boolean(v.priceListItemId || v.title), {
    message: 'Выберите арматурную работу из справочника или назовите свою',
  });

/** Коэффициент цены в процентах: проценты шагом 5 в границах −50 %…+100 %. */
const priceCoefficientField = z
  .number()
  .int()
  .min(PRICE_COEFFICIENT_MIN)
  .max(PRICE_COEFFICIENT_MAX)
  .refine((value) => value % PRICE_COEFFICIENT_STEP === 0, {
    message: 'Коэффициент задаётся шагом 5 %',
  });

export const assessmentPreviewSchema = z
  .object({
    items: z.array(assessmentItemSchema).max(60).default([]),
    extras: z.array(assessmentExtraSchema).max(30).optional(),
    priceCoefficient: priceCoefficientField.optional(),
  })
  .strict()
  .refine((v) => v.items.length > 0 || (v.extras?.length ?? 0) > 0, {
    message: 'Добавьте повреждение или арматурную работу',
  });

export const assessmentAnalyzeSchema = z
  .object({
    photoIds: z.array(z.string().uuid()).min(1).max(6),
    hintPanelCode: optionalString(40),
  })
  .strict();

export const createAssessmentSchema = z
  .object({
    method: z.enum(ASSESSMENT_METHODS),
    items: z.array(assessmentItemSchema).max(60).optional(),
    extras: z.array(assessmentExtraSchema).max(30).optional(),
    /** Коэффициент этой оценки. Без него берётся настройка мастерской. */
    priceCoefficient: priceCoefficientField.optional(),
    /** Итог вручную: для способа manual — единственное, что нужно. */
    totalMinor: z.number().int().min(0).max(1_000_000_000).nullable().optional(),
    note: optionalString(1000),
    applyToDamages: z.boolean().optional(),
    /**
     * Результат разбора фотографии, полученный от `/assessments/analyze`.
     * Пересылается обратно, чтобы сохранённая оценка помнила, какая модель
     * и что именно предложила. Сами цены сервер всё равно считает заново.
     */
    ai: z
      .object({
        provider: z.string().max(60),
        model: z.string().max(120),
        confidence: z.number().min(0).max(1).nullable().optional(),
        explanation: optionalString(2000),
        raw: z.unknown().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const updateAssessmentSchema = z
  .object({
    items: z.array(assessmentItemSchema).max(60).optional(),
    extras: z.array(assessmentExtraSchema).max(30).optional(),
    priceCoefficient: priceCoefficientField.optional(),
    totalMinor: z.number().int().min(0).max(1_000_000_000).nullable().optional(),
    note: optionalString(1000),
  })
  .strict();

// ── Разметка фотографии ──────────────────────────────────────────────────────

/**
 * Одна фигура разметки в нормированных координатах 0–1: снимок открывают
 * и на телефоне, и в вебе, и разметка обязана лечь одинаково при любом размере.
 */
const markupShapeSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('free'),
      color: z.string().max(20).optional(),
      width: z.number().min(0).max(1).optional(),
      points: z
        .array(z.tuple([z.number().min(-1).max(2), z.number().min(-1).max(2)]))
        .min(2)
        .max(2000),
    })
    .strict(),
  z
    .object({
      type: z.literal('circle'),
      color: z.string().max(20).optional(),
      width: z.number().min(0).max(1).optional(),
      cx: z.number().min(-1).max(2),
      cy: z.number().min(-1).max(2),
      rx: z.number().min(0).max(2),
      ry: z.number().min(0).max(2),
    })
    .strict(),
  z
    .object({
      type: z.literal('arrow'),
      color: z.string().max(20).optional(),
      width: z.number().min(0).max(1).optional(),
      x1: z.number().min(-1).max(2),
      y1: z.number().min(-1).max(2),
      x2: z.number().min(-1).max(2),
      y2: z.number().min(-1).max(2),
    })
    .strict(),
]);

export const photoMarkupSchema = z
  .object({
    /** null очищает разметку: оригинал снимка при этом не трогается. */
    annotation: z
      .object({ v: z.literal(1), shapes: z.array(markupShapeSchema).max(200) })
      .strict()
      .nullable(),
    /** Сведённая картинка с разметкой — отдельный файл, а не замена оригинала. */
    annotationFileId: z.string().uuid().nullable().optional(),
  })
  .strict();

export const attachLeadPhotoSchema = z
  .object({
    fileId: z.string().uuid(),
    category: z.enum(PHOTO_CATEGORIES).default('before'),
    damageId: z.string().uuid().nullable().optional(),
    caption: optionalString(200),
  })
  .strict();
