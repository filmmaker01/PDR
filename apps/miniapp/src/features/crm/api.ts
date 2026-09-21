import { useQuery } from '@tanstack/react-query';
import { api } from '@/shared/api';
import type {
  AnalyticsEmployeeRow,
  Assessment,
  AssessmentCapabilities,
  Damage,
  LeadCard,
  LeadListItem,
  LeadsSummary,
  AnalyticsSeriesPoint,
  AnalyticsSummary,
  Appointment,
  AuditEntry,
  AvailabilityResponse,
  InvitationInfo,
  ClientCard,
  Estimate,
  OrderPayments,
  OrderPhoto,
  PaymentJournalEntry,
  PdrDictionaries,
  PriceListItem,
  ClientListItem,
  MemberInfo,
  OrderCard,
  OrderListItem,
  TodaySummary,
  VehicleCard,
  WorkspaceInfo,
} from './types';

export function useWorkspace(workspaceId: string) {
  return useQuery({
    queryKey: ['crm', 'workspace', workspaceId],
    queryFn: () => api.get<WorkspaceInfo>(`/workspaces/${workspaceId}`),
    staleTime: 60_000,
  });
}

export function useMembers(workspaceId: string) {
  return useQuery({
    queryKey: ['crm', 'members', workspaceId],
    queryFn: () => api.get<MemberInfo[]>(`/workspaces/${workspaceId}/members`),
    staleTime: 60_000,
  });
}

export function useToday(workspaceId: string) {
  return useQuery({
    queryKey: ['crm', 'today', workspaceId],
    queryFn: () => api.get<TodaySummary>(`/workspaces/${workspaceId}/today`),
  });
}

export function useOrders(
  workspaceId: string,
  filter: { status?: string[]; q?: string; assigneeMemberId?: string; paymentStatus?: string },
) {
  return useQuery({
    queryKey: ['crm', 'orders', workspaceId, filter],
    queryFn: () =>
      api.get<{ items: OrderListItem[]; nextCursor: string | null }>(
        `/workspaces/${workspaceId}/orders`,
        {
          query: {
            status: filter.status,
            q: filter.q,
            assigneeMemberId: filter.assigneeMemberId,
            paymentStatus: filter.paymentStatus,
            limit: 100,
          },
        },
      ),
  });
}

export function useOrder(workspaceId: string, orderId: string) {
  return useQuery({
    queryKey: ['crm', 'order', workspaceId, orderId],
    queryFn: () => api.get<OrderCard>(`/workspaces/${workspaceId}/orders/${orderId}`),
  });
}

export function useClients(workspaceId: string, q: string) {
  return useQuery({
    queryKey: ['crm', 'clients', workspaceId, q],
    queryFn: () =>
      api.get<{ items: ClientListItem[]; nextCursor: string | null }>(
        `/workspaces/${workspaceId}/clients`,
        { query: { q: q || undefined, limit: 100 } },
      ),
  });
}

export function useClient(workspaceId: string, clientId: string) {
  return useQuery({
    queryKey: ['crm', 'client', workspaceId, clientId],
    queryFn: () => api.get<ClientCard>(`/workspaces/${workspaceId}/clients/${clientId}`),
  });
}

export function useVehicle(workspaceId: string, vehicleId: string) {
  return useQuery({
    queryKey: ['crm', 'vehicle', workspaceId, vehicleId],
    queryFn: () => api.get<VehicleCard>(`/workspaces/${workspaceId}/vehicles/${vehicleId}`),
  });
}

export function useAppointments(
  workspaceId: string,
  range: { from: string; to: string; assigneeMemberId?: string },
) {
  return useQuery({
    queryKey: ['crm', 'appointments', workspaceId, range],
    queryFn: () =>
      api.get<{ timezone: string; items: Appointment[] }>(
        `/workspaces/${workspaceId}/appointments`,
        {
          query: {
            from: range.from,
            to: range.to,
            assigneeMemberId: range.assigneeMemberId,
          },
        },
      ),
  });
}

export function useAvailability(
  workspaceId: string,
  input: {
    day: string;
    assigneeMemberId?: string;
    durationMin: number;
    stepMin?: number;
    excludeId?: string;
    enabled?: boolean;
  },
) {
  return useQuery({
    queryKey: ['crm', 'availability', workspaceId, input],
    enabled: input.enabled !== false,
    queryFn: () =>
      api.get<AvailabilityResponse>(`/workspaces/${workspaceId}/appointments/availability`, {
        query: {
          day: input.day,
          assigneeMemberId: input.assigneeMemberId,
          durationMin: input.durationMin,
          stepMin: input.stepMin,
          excludeId: input.excludeId,
        },
      }),
  });
}

export function useEstimates(workspaceId: string, orderId: string) {
  return useQuery({
    queryKey: ['crm', 'estimates', workspaceId, orderId],
    queryFn: () => api.get<Estimate[]>(`/workspaces/${workspaceId}/orders/${orderId}/estimates`),
  });
}

export function useEstimate(workspaceId: string, estimateId: string) {
  return useQuery({
    queryKey: ['crm', 'estimate', workspaceId, estimateId],
    queryFn: () => api.get<Estimate>(`/workspaces/${workspaceId}/estimates/${estimateId}`),
  });
}

export function usePriceList(workspaceId: string, includeInactive = false) {
  return useQuery({
    queryKey: ['crm', 'price-list', workspaceId, includeInactive],
    queryFn: () =>
      api.get<PriceListItem[]>(`/workspaces/${workspaceId}/price-list`, {
        query: includeInactive ? { all: 'true' } : undefined,
      }),
    staleTime: 60_000,
  });
}

/** Какие документы можно распечатать по заказу. Перечень задаёт сервер. */
export function useOrderDocuments(workspaceId: string) {
  return useQuery({
    queryKey: ['crm', 'order-documents', workspaceId],
    queryFn: () =>
      api.get<{ items: { kind: string; title: string; description: string }[] }>(
        `/workspaces/${workspaceId}/order-documents`,
      ),
    staleTime: Infinity,
  });
}

export function useDictionaries(workspaceId: string) {
  return useQuery({
    queryKey: ['crm', 'dictionaries', workspaceId],
    queryFn: () => api.get<PdrDictionaries>(`/workspaces/${workspaceId}/pdr-dictionaries`),
    // Справочники не меняются в пределах сессии.
    staleTime: Infinity,
  });
}

export function useOrderPayments(workspaceId: string, orderId: string) {
  return useQuery({
    queryKey: ['crm', 'payments', workspaceId, orderId],
    queryFn: () => api.get<OrderPayments>(`/workspaces/${workspaceId}/orders/${orderId}/payments`),
  });
}

export function usePaymentJournal(
  workspaceId: string,
  range: { from: string; to: string; method?: string },
) {
  return useQuery({
    queryKey: ['crm', 'payment-journal', workspaceId, range],
    queryFn: () =>
      api.get<{
        items: PaymentJournalEntry[];
        nextCursor: string | null;
        totals: { kind: string; method: string; totalMinor: number }[];
      }>(`/workspaces/${workspaceId}/payments`, { query: range }),
  });
}

export function useOrderPhotos(workspaceId: string, orderId: string) {
  return useQuery({
    queryKey: ['crm', 'photos', workspaceId, orderId],
    // Те же компоненты открываются и для обращения: без идентификатора заказа
    // запрос ушёл бы на адрес с пустым сегментом пути.
    enabled: Boolean(orderId),
    queryFn: () =>
      api.get<{ categories: Record<string, string>; items: OrderPhoto[] }>(
        `/workspaces/${workspaceId}/orders/${orderId}/photos`,
      ),
  });
}

export function useAnalyticsSummary(
  workspaceId: string,
  period: { from?: string; to?: string; assigneeMemberId?: string },
) {
  return useQuery({
    queryKey: ['crm', 'analytics', 'summary', workspaceId, period],
    queryFn: () =>
      api.get<AnalyticsSummary>(`/workspaces/${workspaceId}/analytics/summary`, { query: period }),
  });
}

export function useAnalyticsSeries(
  workspaceId: string,
  period: { from?: string; to?: string; assigneeMemberId?: string; granularity?: 'day' | 'week' },
) {
  return useQuery({
    queryKey: ['crm', 'analytics', 'series', workspaceId, period],
    queryFn: () =>
      api.get<{ granularity: 'day' | 'week'; points: AnalyticsSeriesPoint[] }>(
        `/workspaces/${workspaceId}/analytics/series`,
        { query: period },
      ),
  });
}

export function useAnalyticsEmployees(workspaceId: string, period: { from?: string; to?: string }) {
  return useQuery({
    queryKey: ['crm', 'analytics', 'employees', workspaceId, period],
    queryFn: () =>
      api.get<{ rows: AnalyticsEmployeeRow[] }>(`/workspaces/${workspaceId}/analytics/employees`, {
        query: period,
      }),
  });
}

export function useWorkspaceAudit(workspaceId: string) {
  return useQuery({
    queryKey: ['crm', 'audit', workspaceId],
    queryFn: () =>
      api.get<{ items: AuditEntry[]; nextCursor: string | null }>(
        `/workspaces/${workspaceId}/audit`,
        { query: { limit: 100 } },
      ),
  });
}

export function useInvitations(workspaceId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['crm', 'invitations', workspaceId],
    enabled,
    queryFn: () => api.get<InvitationInfo[]>(`/workspaces/${workspaceId}/invitations`),
  });
}

// -- Обращения ----------------------------------------------------------------

export interface LeadFilter {
  status?: string[];
  q?: string;
  source?: string;
  channel?: string;
  /** Только те, кому пора звонить. */
  due?: boolean;
}

export function useLeads(workspaceId: string, filter: LeadFilter = {}) {
  return useQuery({
    queryKey: ['crm', 'leads', workspaceId, filter],
    queryFn: () =>
      api.get<{ items: LeadListItem[]; nextCursor: string | null }>(
        `/workspaces/${workspaceId}/leads`,
        {
          query: {
            status: filter.status,
            q: filter.q || undefined,
            source: filter.source,
            channel: filter.channel,
            due: filter.due ? 'true' : undefined,
            limit: 100,
          },
        },
      ),
  });
}

export function useLeadsSummary(workspaceId: string) {
  return useQuery({
    queryKey: ['crm', 'leads-summary', workspaceId],
    queryFn: () => api.get<LeadsSummary>(`/workspaces/${workspaceId}/leads/summary`),
  });
}

export function useLead(workspaceId: string, leadId: string) {
  return useQuery({
    queryKey: ['crm', 'lead', workspaceId, leadId],
    queryFn: () => api.get<LeadCard>(`/workspaces/${workspaceId}/leads/${leadId}`),
  });
}

// -- Повреждения на схеме кузова ----------------------------------------------

/**
 * Повреждения обращения или заказа. Адрес разный, форма ответа одна:
 * схема кузова и карточка повреждения в интерфейсе общие.
 */
export function useDamages(
  workspaceId: string,
  parent: { leadId?: string; orderId?: string },
  enabled = true,
) {
  const path = parent.leadId
    ? `/workspaces/${workspaceId}/leads/${parent.leadId}/damages`
    : `/workspaces/${workspaceId}/orders/${parent.orderId}/damages`;
  return useQuery({
    queryKey: ['crm', 'damages', workspaceId, parent.leadId ?? parent.orderId],
    enabled: enabled && Boolean(parent.leadId || parent.orderId),
    queryFn: () => api.get<{ items: Damage[] }>(path),
  });
}

export function useBodyScheme(workspaceId: string) {
  return useQuery({
    queryKey: ['crm', 'body-scheme', workspaceId],
    queryFn: () =>
      api.get<{
        panels: { code: string; label: string; group: string; oftenAluminum: boolean }[];
        damageTypes: { code: string; label: string; hint?: string }[];
        sizeClasses: { code: string; label: string; hint: string }[];
      }>(`/workspaces/${workspaceId}/body-scheme`),
    staleTime: Infinity,
  });
}

// -- Оценки -------------------------------------------------------------------

export function useAssessments(
  workspaceId: string,
  parent: { leadId?: string; orderId?: string },
  enabled = true,
) {
  const path = parent.leadId
    ? `/workspaces/${workspaceId}/leads/${parent.leadId}/assessments`
    : `/workspaces/${workspaceId}/orders/${parent.orderId}/assessments`;
  return useQuery({
    queryKey: ['crm', 'assessments', workspaceId, parent.leadId ?? parent.orderId],
    enabled: enabled && Boolean(parent.leadId || parent.orderId),
    queryFn: () => api.get<{ items: Assessment[] }>(path),
  });
}

/** Какие способы оценки доступны: кнопка AI прячется, когда провайдер не настроен. */
export function useAssessmentCapabilities(workspaceId: string) {
  return useQuery({
    queryKey: ['crm', 'assessment-capabilities', workspaceId],
    queryFn: () =>
      api.get<AssessmentCapabilities>(`/workspaces/${workspaceId}/assessments/capabilities`),
    staleTime: 300_000,
  });
}

// -- Фотографии ---------------------------------------------------------------

export function useLeadPhotos(workspaceId: string, leadId: string, enabled = true) {
  return useQuery({
    queryKey: ['crm', 'photos', workspaceId, leadId],
    enabled: enabled && Boolean(leadId),
    queryFn: () =>
      api.get<{ items: OrderPhoto[] }>(`/workspaces/${workspaceId}/leads/${leadId}/photos`),
  });
}

/** Путь до снимков обращения или заказа: карточки фотографий общие для обоих. */
export function photosPath(
  workspaceId: string,
  parent: { leadId?: string; orderId?: string },
): string {
  return parent.leadId
    ? `/workspaces/${workspaceId}/leads/${parent.leadId}/photos`
    : `/workspaces/${workspaceId}/orders/${parent.orderId}/photos`;
}

/**
 * Снимки конкретного повреждения.
 *
 * Отдельного эндпоинта нет намеренно: список фотографий карточки и так
 * приходит одним запросом, а фильтрация по повреждению на клиенте избавляет
 * от второго обращения к серверу при каждом открытии детали.
 */
export function useDamagePhotos(
  workspaceId: string,
  parent: { leadId?: string; orderId?: string },
  damageId: string | null,
  enabled = true,
): OrderPhoto[] {
  const leadPhotos = useLeadPhotos(
    workspaceId,
    parent.leadId ?? '',
    enabled && Boolean(parent.leadId),
  );
  const orderPhotos = useOrderPhotos(workspaceId, parent.orderId ?? '');
  const items = parent.leadId ? (leadPhotos.data?.items ?? []) : (orderPhotos.data?.items ?? []);
  return damageId ? items.filter((photo) => photo.damageId === damageId) : [];
}
