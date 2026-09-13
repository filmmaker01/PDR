import { useQuery } from '@tanstack/react-query';
import { api } from '@/shared/api';
import type {
  ClientCard,
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
