import type { MarkupDoc } from '@pdr/ui';
import type {
  AssessmentMethod,
  DamagePriceSource,
  LeadChannel,
  LeadSource,
  LeadStatus,
} from '@pdr/shared';

export type OrderStatus =
  'new' | 'pending_approval' | 'scheduled' | 'in_progress' | 'ready' | 'delivered' | 'cancelled';

export type PaymentStatus = 'unpaid' | 'partial' | 'paid' | 'overpaid';

export interface OrderListItem {
  id: string;
  number: number;
  status: OrderStatus;
  statusLabel: string;
  paymentStatus: PaymentStatus;
  title: string | null;
  agreedTotalMinor: number | null;
  paidMinor: number;
  currency: string;
  client: { id: string; name: string; phone: string | null };
  vehicle: { id: string; make: string; model: string; plate: string | null } | null;
  assignee: { id: string; name: string; color: string | null } | null;
  scheduledStartAt: string | null;
  createdAt: string;
}

export interface OrderCard extends OrderListItem {
  appointments: OrderAppointment[];
  damageSummary: string | null;
  internalNotes: string | null;
  clientNotes: string | null;
  startedAt: string | null;
  readyAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  archivedAt: string | null;
  allowedTransitions: { status: OrderStatus; label: string }[];
  history: {
    id: string;
    fromStatus: OrderStatus | null;
    toStatus: OrderStatus;
    comment: string | null;
    createdAt: string;
    changedBy: string;
  }[];
}

export interface ClientListItem {
  id: string;
  name: string;
  phone: string | null;
  tags: string[];
  archivedAt: string | null;
  vehicles: {
    id: string;
    make: string;
    model: string;
    plate: string | null;
    year: number | null;
  }[];
  createdAt: string;
}

export interface ClientCard {
  id: string;
  name: string;
  phone: string | null;
  phoneExtra: string | null;
  telegramUsername: string | null;
  source: string | null;
  notes: string | null;
  tags: string[];
  archivedAt: string | null;
  anonymizedAt: string | null;
  currency: string;
  vehicles: {
    id: string;
    make: string;
    model: string;
    year: number | null;
    color: string | null;
    plate: string | null;
    vin: string | null;
  }[];
  orders: {
    id: string;
    number: number;
    status: OrderStatus;
    paymentStatus: PaymentStatus;
    title: string | null;
    agreedTotalMinor: number | null;
    paidMinor: number;
    vehicle: { id: string; make: string; model: string; plate: string | null } | null;
    createdAt: string;
  }[];
}

export interface VehicleCard {
  id: string;
  make: string;
  model: string;
  year: number | null;
  color: string | null;
  plate: string | null;
  vin: string | null;
  bodyType: string | null;
  notes: string | null;
  archivedAt: string | null;
  client: { id: string; name: string; phone: string | null };
  orders: {
    id: string;
    number: number;
    status: OrderStatus;
    title: string | null;
    agreedTotalMinor: number | null;
    paidMinor: number;
    currency: string;
    createdAt: string;
    deliveredAt: string | null;
  }[];
}

export interface TodaySummary {
  activeCount: number;
  readyCount: number;
  currency: string;
}

export interface WorkspaceInfo {
  id: string;
  name: string;
  timezone: string;
  currency: string;
  settings: Record<string, unknown>;
  role: 'owner' | 'employee';
  memberId: string;
  permissions: string[];
  access: { active: boolean; validUntil: string | null };
  storage?: { usedBytes: number; quotaBytes: number; warn: boolean };
}

export interface MemberInfo {
  id: string;
  userId: string;
  role: 'owner' | 'employee';
  name: string;
  username: string | null;
  color: string | null;
  isActive: boolean;
}

export const STATUS_TONES: Record<
  OrderStatus,
  'info' | 'success' | 'warning' | 'muted' | 'danger'
> = {
  new: 'muted',
  pending_approval: 'warning',
  scheduled: 'info',
  in_progress: 'info',
  ready: 'success',
  delivered: 'success',
  cancelled: 'danger',
};

export const PAYMENT_LABELS: Record<PaymentStatus, string> = {
  unpaid: 'Не оплачен',
  partial: 'Частично',
  paid: 'Оплачен',
  overpaid: 'Переплата',
};

export type AppointmentStatus = 'planned' | 'confirmed' | 'done' | 'cancelled' | 'no_show';
export type AppointmentKind = 'inspection' | 'repair' | 'delivery' | 'other';

export interface Appointment {
  id: string;
  startsAt: string;
  endsAt: string;
  /** Локальное время мастерской: `YYYY-MM-DDTHH:mm:ss`. */
  startsAtLocal: string;
  endsAtLocal: string;
  durationMin: number;
  kind: AppointmentKind;
  kindLabel: string;
  status: AppointmentStatus;
  statusLabel: string;
  allowedTransitions: { status: AppointmentStatus; label: string }[];
  allowOverlap: boolean;
  title: string | null;
  note: string | null;
  cancelReason: string | null;
  client: { id: string; name: string; phone: string | null } | null;
  order: {
    id: string;
    number: number;
    title: string | null;
    status: OrderStatus;
    vehicle: { id: string; make: string; model: string; plate: string | null } | null;
  } | null;
  assignee: { id: string; name: string; color: string | null } | null;
  createdAt: string;
}

export interface OrderAppointment {
  id: string;
  startsAt: string;
  endsAt: string;
  durationMin: number;
  kind: AppointmentKind;
  kindLabel: string;
  status: AppointmentStatus;
  statusLabel: string;
  note: string | null;
  assignee: { id: string; name: string } | null;
}

export interface AvailabilityResponse {
  day: string;
  timezone: string;
  assigneeMemberId: string;
  durationMin: number;
  slots: { startsAtLocal: string; startsAt: string; endsAt: string }[];
  busy: { startsAt: string; endsAt: string }[];
}

export interface OverlapConflict {
  id: string;
  startsAt: string;
  endsAt: string;
  title: string | null;
  clientName: string | null;
  orderNumber: number | null;
}

export const APPOINTMENT_STATUS_TONES: Record<
  AppointmentStatus,
  'info' | 'success' | 'warning' | 'muted' | 'danger'
> = {
  planned: 'info',
  confirmed: 'success',
  done: 'muted',
  cancelled: 'danger',
  no_show: 'warning',
};

export const APPOINTMENT_KIND_OPTIONS: { value: AppointmentKind; label: string }[] = [
  { value: 'inspection', label: 'Осмотр' },
  { value: 'repair', label: 'Ремонт' },
  { value: 'delivery', label: 'Выдача' },
  { value: 'other', label: 'Другое' },
];

export type EstimateStatus = 'draft' | 'sent' | 'agreed' | 'rejected' | 'superseded';
export type EstimateItemKind = 'damage' | 'disassembly' | 'extra';
export type DiscountKind = 'none' | 'percent' | 'fixed';

export interface EstimateItem {
  id: string;
  position: number;
  kind: EstimateItemKind;
  kindLabel: string;
  title: string;
  panelCode: string | null;
  damageType: string | null;
  sizeClass: string | null;
  quantity: number;
  material: 'steel' | 'aluminum' | 'other' | null;
  accessDifficulty: 'easy' | 'medium' | 'hard' | null;
  onEdge: boolean;
  unitPriceMinor: number;
  lineTotalMinor: number;
  priceListItemId: string | null;
  comment: string | null;
}

export interface Estimate {
  id: string;
  orderId: string;
  versionNo: number;
  status: EstimateStatus;
  statusLabel: string;
  currency: string;
  subtotalMinor: number;
  discountKind: DiscountKind;
  discountValue: number;
  discountMinor: number;
  totalMinor: number;
  noteForClient: string | null;
  internalNote: string | null;
  sentAt: string | null;
  agreedAt: string | null;
  rejectedAt: string | null;
  rejectReason: string | null;
  createdAt: string;
  createdBy: string | null;
  agreedBy: string | null;
  items: EstimateItem[];
}

export interface PriceListItem {
  id: string;
  kind: EstimateItemKind;
  title: string;
  panelCode: string | null;
  damageType: string | null;
  sizeClass: string | null;
  unitPriceMinor: number;
  unit: 'per_item' | 'per_dent' | 'per_hour';
  unitLabel: string;
  isActive: boolean;
  position: number;
}

export interface PdrDictionaries {
  panels: { code: string; label: string; group: string }[];
  damageTypes: { code: string; label: string; hint?: string }[];
  sizeClasses: { code: string; label: string; hint: string; widthCm?: number; heightCm?: number }[];
  itemKinds: Record<string, string>;
  materials: Record<string, string>;
  accessDifficulties: Record<string, string>;
  priceUnits: Record<string, string>;
}

export const ESTIMATE_STATUS_TONES: Record<
  EstimateStatus,
  'info' | 'success' | 'warning' | 'muted' | 'danger'
> = {
  draft: 'muted',
  sent: 'warning',
  agreed: 'success',
  rejected: 'danger',
  superseded: 'muted',
};

export type PaymentKind = 'payment' | 'refund' | 'correction';
export type PaymentMethod = 'cash' | 'card' | 'transfer' | 'sbp' | 'other';
export type PaymentPurpose = 'prepayment' | 'payment' | 'final' | 'refund' | 'correction';
export type PhotoCategory = 'before' | 'during' | 'after' | 'document';

export interface PaymentEntry {
  id: string;
  kind: PaymentKind;
  kindLabel: string;
  amountMinor: number;
  signedAmountMinor: number;
  currency: string;
  method: PaymentMethod;
  methodLabel: string;
  purpose: PaymentPurpose;
  purposeLabel: string;
  occurredAt: string;
  note: string | null;
  correctsEntryId: string | null;
  createdAt: string;
  createdBy: string | null;
}

export interface OrderPayments {
  currency: string;
  agreedTotalMinor: number | null;
  paidMinor: number;
  remainingMinor: number;
  paymentStatus: PaymentStatus;
  entries: PaymentEntry[];
}

export interface PaymentJournalEntry extends PaymentEntry {
  order: { id: string; number: number; clientName: string };
}

export interface OrderPhoto {
  id: string;
  fileId: string;
  leadId: string | null;
  orderId: string | null;
  category: PhotoCategory;
  categoryLabel: string;
  caption: string | null;
  position: number;
  /** Привязка снимка к конкретному повреждению на схеме кузова. */
  damageId: string | null;
  estimateItemId: string | null;
  /** Векторная разметка: рисуется поверх оригинала, сам файл не меняется. */
  annotation: MarkupDoc | null;
  hasMarkup: boolean;
  annotationFileId: string | null;
  annotatedAt: string | null;
  status: string;
  width: number | null;
  height: number | null;
  thumbUrl: string | null;
  createdAt: string;
}

export const PHOTO_CATEGORY_OPTIONS: { value: PhotoCategory; label: string }[] = [
  { value: 'before', label: 'До' },
  { value: 'during', label: 'В процессе' },
  { value: 'after', label: 'После' },
  { value: 'document', label: 'Документы' },
];

export const PAYMENT_METHOD_OPTIONS: { value: PaymentMethod; label: string }[] = [
  { value: 'cash', label: 'Наличные' },
  { value: 'card', label: 'Карта' },
  { value: 'transfer', label: 'Перевод' },
  { value: 'sbp', label: 'СБП' },
  { value: 'other', label: 'Другое' },
];

export interface AnalyticsSummary {
  from: string;
  to: string;
  currency: string;
  completedOrders: number;
  completedTotalMinor: number;
  receivedMinor: number;
  averageCheckMinor: number;
  newClients: number;
  appointmentMinutes: number;
}

export interface AnalyticsSeriesPoint {
  bucket: string;
  completedOrders: number;
  completedTotalMinor: number;
  receivedMinor: number;
}

export interface AnalyticsEmployeeRow {
  memberId: string | null;
  name: string;
  color: string | null;
  isActive: boolean;
  completedOrders: number;
  completedTotalMinor: number;
  receivedMinor: number;
  appointmentMinutes: number;
}

export interface AuditEntry {
  id: string;
  createdAt: string;
  actorUserId: string | null;
  actorRoleContext: string | null;
  entityType: string;
  entityId: string | null;
  action: string;
  before: unknown;
  after: unknown;
}

export interface InvitationInfo {
  id: string;
  role: 'employee';
  invitedPhone: string | null;
  note: string | null;
  expiresAt: string;
  createdAt: string;
}

// -- Обращения, повреждения, оценки -------------------------------------------

export type { AssessmentMethod, DamagePriceSource, LeadChannel, LeadSource, LeadStatus };

export interface LeadListItem {
  id: string;
  number: number;
  status: LeadStatus;
  statusLabel: string;
  source: LeadSource;
  sourceLabel: string;
  channel: LeadChannel | null;
  channelLabel: string | null;
  contact: {
    clientId: string | null;
    name: string | null;
    phone: string | null;
    extra: string | null;
  };
  vehicle: {
    vehicleId: string | null;
    make: string | null;
    model: string | null;
    plate: string | null;
    year: number | null;
    color: string | null;
  };
  comment: string | null;
  estimateMinor: number | null;
  currency: string;
  nextContactAt: string | null;
  rejectReason: string | null;
  assignee: { id: string; name: string; color: string | null } | null;
  convertedOrder: { id: string; number: number } | null;
  convertedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  allowedTransitions: { status: LeadStatus; label: string }[];
}

export interface LeadCard extends LeadListItem {
  history: {
    id: string;
    fromStatus: LeadStatus | null;
    toStatus: LeadStatus;
    comment: string | null;
    createdAt: string;
    changedBy: string;
  }[];
}

export interface LeadsSummary {
  total: number;
  byStatus: Record<string, number>;
  rejected: number;
  /** Сколько обращений «перезвонить» уже просрочено. */
  due: number;
}

export interface Damage {
  id: string;
  leadId: string | null;
  orderId: string | null;
  panelCode: string;
  damageType: string | null;
  sizeClass: string | null;
  widthMm: number | null;
  heightMm: number | null;
  quantity: number;
  material: 'steel' | 'aluminum' | 'other' | null;
  accessDifficulty: 'easy' | 'medium' | 'hard' | null;
  onEdge: boolean;
  comment: string | null;
  priceMinor: number | null;
  priceSource: DamagePriceSource | null;
  position: number;
  photoCount: number;
  createdAt: string;
}

export interface AssessmentItem {
  id: string;
  damageId: string | null;
  /** PDR-ремонт или арматурная работа. */
  kind: EstimateItemKind;
  /** Название арматурной работы; у PDR-строк собирается из детали и размера. */
  title: string | null;
  position: number;
  panelCode: string | null;
  damageType: string | null;
  sizeClass: string | null;
  widthMm: number | null;
  heightMm: number | null;
  quantity: number;
  material: 'steel' | 'aluminum' | 'other' | null;
  accessDifficulty: 'easy' | 'medium' | 'hard' | null;
  onEdge: boolean;
  suggestedUnitPriceMinor: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
  priceListItemId: string | null;
  confidence: number | null;
  comment: string | null;
}

export interface Assessment {
  id: string;
  leadId: string | null;
  orderId: string | null;
  method: AssessmentMethod;
  methodLabel: string;
  currency: string;
  suggestedMinor: number;
  /** Базовый расчёт PDR до коэффициента: остаётся видимым всегда. */
  baseMinor: number;
  /** Коэффициент цены в процентах. */
  priceCoefficient: number;
  /** PDR после коэффициента. */
  pdrMinor: number;
  /** Арматурные работы. */
  extrasMinor: number;
  /** Готовая подпись расчёта: «База 4 000 ₽ × 1.20 = 4 800 ₽». */
  formula: string;
  totalMinor: number;
  overridden: boolean;
  explanation: string | null;
  note: string | null;
  ai: { provider: string; model: string | null; confidence: number | null } | null;
  createdAt: string;
  createdBy: string | null;
  items: AssessmentItem[];
}

/** Строка расчёта, который пришёл с сервера и ещё не сохранён. */
export interface AssessmentLine {
  damageId: string | null;
  position: number;
  panelCode: string;
  damageType: string | null;
  sizeClass: string | null;
  quantity: number;
  priceListItemId: string | null;
  priceListTitle: string | null;
  basePriceMinor: number;
  multipliers: { reason: string; factor: number }[];
  suggestedUnitPriceMinor: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
  overridden: boolean;
  explanation: string;
  comment: string | null;
}

/** Строка арматурной работы в расчёте, который пришёл с сервера. */
export interface AssessmentExtraLine {
  priceListItemId: string | null;
  damageId: string | null;
  position: number;
  title: string;
  quantity: number;
  suggestedUnitPriceMinor: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
  overridden: boolean;
  comment: string | null;
}

export interface AssessmentPreview {
  suggestedMinor: number;
  /** База PDR до коэффициента. */
  baseMinor: number;
  priceCoefficient: number;
  /** PDR после коэффициента. */
  pdrMinor: number;
  extrasMinor: number;
  totalMinor: number;
  explanation: string;
  /** Формула расчёта одной строкой — приходит с сервера, а не собирается здесь. */
  formula: string;
  lines: AssessmentLine[];
  extras: AssessmentExtraLine[];
  currency: string;
}

export interface AssessmentAnalysis extends AssessmentPreview {
  label: string;
  disclaimer: string;
  ai: {
    provider: string;
    model: string;
    confidence: number | null;
    explanation: string;
    raw: unknown;
  };
  items: DamageDraft[];
}

export interface AssessmentCapabilities {
  /** Границы ползунка коэффициента приходят с сервера. */
  priceCoefficient: { min: number; max: number; step: number };
  methods: { value: AssessmentMethod; label: string; available: boolean; provider?: string }[];
}

/** Повреждение в форме, ещё не сохранённое на сервере. */
export interface DamageDraft {
  panelCode: string;
  damageType?: string | null;
  sizeClass?: string | null;
  widthMm?: number | null;
  heightMm?: number | null;
  quantity?: number;
  material?: 'steel' | 'aluminum' | 'other' | null;
  accessDifficulty?: 'easy' | 'medium' | 'hard' | null;
  onEdge?: boolean;
  comment?: string | null;
}

export const LEAD_STATUS_TONES: Record<
  LeadStatus,
  'info' | 'success' | 'warning' | 'muted' | 'danger'
> = {
  new: 'info',
  estimated: 'info',
  awaiting_decision: 'warning',
  callback: 'warning',
  scheduled: 'success',
  rejected: 'muted',
};

export const LEAD_CHANNEL_OPTIONS: { value: LeadChannel; label: string }[] = [
  { value: 'telegram', label: 'Telegram' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'vk', label: 'VK' },
  { value: 'call', label: 'Звонок' },
  { value: 'in_person', label: 'Лично' },
  { value: 'other', label: 'Другое' },
];

export const MATERIAL_OPTIONS: { value: 'steel' | 'aluminum' | 'other'; label: string }[] = [
  { value: 'steel', label: 'Сталь' },
  { value: 'aluminum', label: 'Алюминий' },
  { value: 'other', label: 'Другое' },
];

export const ACCESS_OPTIONS: { value: 'easy' | 'medium' | 'hard'; label: string }[] = [
  { value: 'easy', label: 'Простой доступ' },
  { value: 'medium', label: 'Средний' },
  { value: 'hard', label: 'Сложный' },
];
