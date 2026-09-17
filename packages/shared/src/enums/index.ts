/**
 * Единый источник значений enum'ов. Дублируется в Prisma schema;
 * тест `enums.test.ts` в apps/api сверяет соответствие.
 */

export const PLATFORM_ROLES = ['admin', 'curator'] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export const SESSION_KINDS = ['miniapp', 'web'] as const;
export type SessionKind = (typeof SESSION_KINDS)[number];

export const PRODUCTS = ['course', 'crm', 'club'] as const;
export type Product = (typeof PRODUCTS)[number];

export const GRANT_SUBJECTS = ['user', 'workspace'] as const;
export type GrantSubject = (typeof GRANT_SUBJECTS)[number];

export const GRANT_STATUSES = ['active', 'expired', 'revoked', 'suspended'] as const;
export type GrantStatus = (typeof GRANT_STATUSES)[number];

export const GRANT_SOURCES = ['manual', 'promo', 'migration', 'payment'] as const;
export type GrantSource = (typeof GRANT_SOURCES)[number];

export const WORKSPACE_ROLES = ['owner', 'employee'] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export const VERSION_STATUSES = ['draft', 'published', 'archived'] as const;
export type VersionStatus = (typeof VERSION_STATUSES)[number];

export const MATERIAL_KINDS = ['file', 'link', 'text'] as const;
export type MaterialKind = (typeof MATERIAL_KINDS)[number];

export const VIDEO_STATUSES = ['uploading', 'processing', 'ready', 'failed'] as const;
export type VideoStatus = (typeof VIDEO_STATUSES)[number];

export const UNLOCK_MODES = ['interval', 'dates'] as const;
export type UnlockMode = (typeof UNLOCK_MODES)[number];

export const ENROLLMENT_STATUSES = ['active', 'completed', 'paused', 'withdrawn'] as const;
export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];

export const OVERRIDE_ACTIONS = ['unlock', 'lock'] as const;
export type OverrideAction = (typeof OVERRIDE_ACTIONS)[number];

export const SUBMISSION_STATUSES = [
  'draft',
  'submitted',
  'in_review',
  'accepted',
  'returned',
] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

export const REVIEW_DECISIONS = ['accepted', 'returned'] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

export const EXAM_KINDS = ['test', 'practical'] as const;
export type ExamKind = (typeof EXAM_KINDS)[number];

export const QUESTION_KINDS = ['single', 'multiple', 'boolean', 'short_text'] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];

export const ATTEMPT_STATUSES = [
  'in_progress',
  'submitted',
  'graded',
  'expired',
  'cancelled',
] as const;
export type AttemptStatus = (typeof ATTEMPT_STATUSES)[number];

export const ORDER_STATUSES = [
  'new',
  'pending_approval',
  'scheduled',
  'in_progress',
  'ready',
  'delivered',
  'cancelled',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PAYMENT_STATUSES = ['unpaid', 'partial', 'paid', 'overpaid'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const APPOINTMENT_KINDS = ['inspection', 'repair', 'delivery', 'other'] as const;
export type AppointmentKind = (typeof APPOINTMENT_KINDS)[number];

export const APPOINTMENT_STATUSES = [
  'planned',
  'confirmed',
  'done',
  'cancelled',
  'no_show',
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const PHOTO_CATEGORIES = ['before', 'during', 'after', 'document'] as const;
export type PhotoCategory = (typeof PHOTO_CATEGORIES)[number];

export const ESTIMATE_STATUSES = ['draft', 'sent', 'agreed', 'rejected', 'superseded'] as const;
export type EstimateStatus = (typeof ESTIMATE_STATUSES)[number];

export const ESTIMATE_ITEM_KINDS = ['damage', 'disassembly', 'extra'] as const;
export type EstimateItemKind = (typeof ESTIMATE_ITEM_KINDS)[number];

export const DISCOUNT_KINDS = ['none', 'percent', 'fixed'] as const;
export type DiscountKind = (typeof DISCOUNT_KINDS)[number];

export const PRICE_UNITS = ['per_item', 'per_dent', 'per_hour'] as const;
export type PriceUnit = (typeof PRICE_UNITS)[number];

export const MATERIALS = ['steel', 'aluminum', 'other'] as const;
export type Material = (typeof MATERIALS)[number];

export const ACCESS_DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
export type AccessDifficulty = (typeof ACCESS_DIFFICULTIES)[number];

export const PAYMENT_KINDS = ['payment', 'refund', 'correction'] as const;
export type PaymentKind = (typeof PAYMENT_KINDS)[number];

export const PAYMENT_METHODS = ['cash', 'card', 'transfer', 'sbp', 'other'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_PURPOSES = ['prepayment', 'payment', 'final', 'refund', 'correction'] as const;
export type PaymentPurpose = (typeof PAYMENT_PURPOSES)[number];

export const FILE_SCOPES = [
  'order_photo',
  'submission',
  'exam_attempt',
  'lesson_material',
  'avatar',
  'export',
  'course_cover',
  'question_image',
] as const;
export type FileScope = (typeof FILE_SCOPES)[number];

export const FILE_STATUSES = [
  'pending',
  'uploaded',
  'processing',
  'ready',
  'failed',
  'deleted',
] as const;
export type FileStatus = (typeof FILE_STATUSES)[number];

export const LEAD_SOURCES = ['online', 'offline'] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export const LEAD_CHANNELS = [
  'telegram',
  'whatsapp',
  'vk',
  'call',
  'in_person',
  'other',
] as const;
export type LeadChannel = (typeof LEAD_CHANNELS)[number];

export const LEAD_STATUSES = [
  'new',
  'estimated',
  'awaiting_decision',
  'callback',
  'scheduled',
  'rejected',
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const ASSESSMENT_METHODS = ['manual', 'params', 'ai'] as const;
export type AssessmentMethod = (typeof ASSESSMENT_METHODS)[number];

export const DAMAGE_PRICE_SOURCES = ['manual', 'params', 'ai'] as const;
export type DamagePriceSource = (typeof DAMAGE_PRICE_SOURCES)[number];

export const CLUB_STATUSES = [
  'none',
  'invited',
  'join_requested',
  'approved',
  'member',
  'left',
  'removed',
  'declined',
] as const;
export type ClubStatus = (typeof CLUB_STATUSES)[number];

export const NOTIFICATION_STATUSES = ['queued', 'sent', 'failed', 'skipped'] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

export const EXPORT_KINDS = [
  'crm_full',
  'crm_clients',
  'crm_orders',
  'crm_payments',
  'learning_students',
  'learning_progress',
  'audit',
] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

export const EXPORT_STATUSES = ['queued', 'running', 'done', 'failed'] as const;
export type ExportStatus = (typeof EXPORT_STATUSES)[number];

export const WEB_LOGIN_STATUSES = ['pending', 'confirmed', 'expired', 'used'] as const;
export type WebLoginStatus = (typeof WEB_LOGIN_STATUSES)[number];
