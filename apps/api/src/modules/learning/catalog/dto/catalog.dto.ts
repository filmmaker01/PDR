import { z } from 'zod';
import { nonEmptyString, optionalString } from '@pdr/shared';

const keySchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9-]{0,58}[a-z0-9]$/, 'Латиница, цифры и дефисы, например «stage-1»');

export const createCourseSchema = z
  .object({
    slug: keySchema,
    title: nonEmptyString(200),
    description: optionalString(2000),
  })
  .strict();

export const updateCourseSchema = z
  .object({
    title: nonEmptyString(200).optional(),
    description: optionalString(2000),
    isActive: z.boolean().optional(),
  })
  .strict();

export const publishSchema = z.object({ changelog: optionalString(1000) }).strict();

export const createStageSchema = z
  .object({
    key: keySchema,
    title: nonEmptyString(200),
    description: optionalString(4000),
    unlockDaysOffset: z.number().int().min(0).max(3650).default(0),
    requiresPreviousStage: z.boolean().default(true),
  })
  .strict();

export const updateStageSchema = z
  .object({
    title: nonEmptyString(200).optional(),
    description: optionalString(4000),
    unlockDaysOffset: z.number().int().min(0).max(3650).optional(),
    requiresPreviousStage: z.boolean().optional(),
    coverFileId: z.string().uuid().nullable().optional(),
  })
  .strict();

export const reorderSchema = z.object({ order: z.array(z.string().uuid()).min(1) }).strict();

export const createLessonSchema = z
  .object({
    key: keySchema,
    title: nonEmptyString(200),
    description: optionalString(20000),
    isRequired: z.boolean().default(true),
    videoAssetId: z.string().uuid().nullable().optional(),
    minWatchPercent: z.number().int().min(0).max(100).default(0),
    estimatedMinutes: z.number().int().min(1).max(600).nullable().optional(),
  })
  .strict();

export const updateLessonSchema = createLessonSchema.partial().omit({ key: true }).strict();

export const createMaterialSchema = z
  .object({
    kind: z.enum(['file', 'link', 'text']),
    title: nonEmptyString(200),
    fileId: z.string().uuid().nullable().optional(),
    url: z.string().url().max(2000).nullable().optional(),
    body: optionalString(20000),
  })
  .strict();

export const requiredMediaSchema = z
  .object({
    min_photos: z.number().int().min(0).max(20).optional(),
    min_videos: z.number().int().min(0).max(5).optional(),
    text_required: z.boolean().optional(),
  })
  .strict();

export const createAssignmentSchema = z
  .object({
    key: keySchema,
    title: nonEmptyString(200),
    instructions: nonEmptyString(20000),
    lessonId: z.string().uuid().nullable().optional(),
    isRequired: z.boolean().default(true),
    requiredMedia: requiredMediaSchema.optional(),
    maxVideoSec: z.number().int().min(5).max(3600).nullable().optional(),
  })
  .strict();

export const updateAssignmentSchema = createAssignmentSchema.partial().omit({ key: true }).strict();

export const createExamSchema = z
  .object({
    key: keySchema,
    title: nonEmptyString(200),
    kind: z.enum(['test', 'practical']),
    passingScore: z.number().int().min(0).max(100),
    description: optionalString(4000),
    maxAttempts: z.number().int().min(1).max(50).nullable().optional(),
    timeLimitSec: z.number().int().min(60).max(36000).nullable().optional(),
    cooldownHours: z.number().int().min(0).max(720).default(0),
    shuffleQuestions: z.boolean().default(true),
    questionsPerAttempt: z.number().int().min(1).max(500).nullable().optional(),
    showExplanations: z.boolean().default(true),
    isRequired: z.boolean().default(true),
  })
  .strict();

export const updateExamSchema = createExamSchema.partial().omit({ key: true, kind: true }).strict();

export const upsertQuestionSchema = z
  .object({
    questionId: z.string().uuid().optional(),
    kind: z.enum(['single', 'multiple', 'boolean', 'short_text']),
    body: nonEmptyString(4000),
    explanation: optionalString(4000),
    points: z.number().int().min(1).max(100).default(1),
    imageFileId: z.string().uuid().nullable().optional(),
    acceptedAnswers: z.array(z.string().trim().min(1).max(200)).max(20).nullable().optional(),
    options: z
      .array(z.object({ body: nonEmptyString(1000), isCorrect: z.boolean() }))
      .max(10)
      .optional(),
  })
  .strict();

export const createVideoSchema = z.object({ title: nonEmptyString(200) }).strict();
