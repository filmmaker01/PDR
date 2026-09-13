import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '@pdr/api-client';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: (count, error) =>
        error instanceof ApiError && error.status < 500 && error.status !== 429 ? false : count < 2,
      refetchOnWindowFocus: false,
    },
    mutations: { retry: 0 },
  },
});
