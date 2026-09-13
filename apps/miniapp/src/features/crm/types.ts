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
  debtMinor: number;
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
  debtMinor: number;
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
  debt: { count: number; totalMinor: number };
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
