import { useQuery } from '@tanstack/react-query';
import { api } from '@/shared/api';
import type {
  Appointment,
  AvailabilityResponse,
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

export function useDebts(workspaceId: string) {
  return useQuery({
    queryKey: ['crm', 'debts', workspaceId],
    queryFn: () =>
      api.get<
        {
          id: string;
          number: number;
          clientName: string;
          clientPhone: string | null;
          status: string;
          agreedTotalMinor: number;
          paidMinor: number;
          debtMinor: number;
          currency: string;
          deliveredAt: string | null;
        }[]
      >(`/workspaces/${workspaceId}/debts`),
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
    queryFn: () =>
      api.get<{ categories: Record<string, string>; items: OrderPhoto[] }>(
        `/workspaces/${workspaceId}/orders/${orderId}/photos`,
      ),
  });
}
