import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '@pdr/api-client';
export const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 30_000,
            gcTime: 5 * 60_000,
            retry: (failureCount, error) => {
                if (error instanceof ApiError) {
                    // Ошибки прав и состояния повторять бессмысленно.
                    if (error.status < 500 && error.status !== 429)
                        return false;
                }
                return failureCount < 2;
            },
            refetchOnWindowFocus: false,
        },
        mutations: { retry: 0 },
    },
});
//# sourceMappingURL=queryClient.js.map