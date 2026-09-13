import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationOptions,
} from '@tanstack/react-query';
import { notifications } from '@mantine/notifications';
import { ApiError } from '@pdr/api-client';
import { api } from './api';

export function useApiQuery<T>(
  key: readonly unknown[],
  path: string,
  options: { query?: Record<string, unknown>; enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: [...key, options.query ?? null],
    enabled: options.enabled ?? true,
    queryFn: () =>
      api.get<T>(path, {
        query: options.query as Record<string, string | number | boolean | undefined>,
      }),
  });
}

/** Мутация с уведомлением об ошибке и инвалидацией затронутых ключей. */
export function useApiMutation<TData, TVars>(
  fn: (vars: TVars) => Promise<TData>,
  options: {
    invalidate?: readonly unknown[][];
    successMessage?: string;
  } & Omit<UseMutationOptions<TData, Error, TVars>, 'mutationFn'> = {},
) {
  const queryClient = useQueryClient();
  const { invalidate, successMessage, ...rest } = options;

  return useMutation<TData, Error, TVars>({
    mutationFn: fn,
    ...rest,
    onSuccess: async (data, vars, ctx, mutation) => {
      for (const key of invalidate ?? []) {
        await queryClient.invalidateQueries({ queryKey: key });
      }
      if (successMessage) {
        notifications.show({ message: successMessage, color: 'green' });
      }
      await rest.onSuccess?.(data, vars, ctx, mutation);
    },
    onError: (error, vars, ctx, mutation) => {
      notifications.show({
        title: 'Не получилось',
        message: error instanceof ApiError ? error.message : 'Неизвестная ошибка',
        color: 'red',
      });
      rest.onError?.(error, vars, ctx, mutation);
    },
  });
}

export function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Не удалось загрузить данные';
}
