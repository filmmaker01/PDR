import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@pdr/api-client';
import { Badge, Button, Card, EmptyState, ListItem, SkeletonList } from '@pdr/ui';
import { api } from '@/shared/api';
import { formatDateTime } from '@/shared/format';
import { alertDialog, haptic, openLink } from '@/shared/telegram';
import { useWorkspace } from './api';

interface ExportRecord {
  id: string;
  kind: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  rowCount: number | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
  ready: boolean;
}

const KIND_LABELS: Record<string, string> = {
  crm_full: 'Вся база (архив)',
  crm_clients: 'Клиенты',
  crm_orders: 'Заказы',
  crm_payments: 'Оплаты',
};

const STATUS_LABELS: Record<string, string> = {
  queued: 'в очереди',
  running: 'собирается',
  done: 'готова',
  failed: 'ошибка',
};

/** Выгрузка данных мастерской: владелец забирает свою базу когда захочет. */
export function ExportScreen() {
  const { workspaceId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const workspace = useWorkspace(workspaceId);
  const [includePhotos, setIncludePhotos] = useState(false);

  const exports = useQuery({
    queryKey: ['crm', 'exports', workspaceId],
    queryFn: () => api.get<ExportRecord[]>(`/workspaces/${workspaceId}/exports`),
    // Пока выгрузка собирается, состояние нужно обновлять.
    refetchInterval: (query) =>
      (query.state.data ?? []).some((item) => item.status === 'queued' || item.status === 'running')
        ? 3000
        : false,
  });

  const request = useMutation({
    mutationFn: (kind: string) =>
      api.post(`/workspaces/${workspaceId}/exports`, { kind, includePhotos }),
    onSuccess: async () => {
      haptic('success');
      await queryClient.invalidateQueries({ queryKey: ['crm', 'exports'] });
    },
    onError: async (e) =>
      alertDialog(e instanceof ApiError ? e.message : 'Не удалось заказать выгрузку'),
  });

  const download = useMutation({
    mutationFn: async (exportId: string) => {
      const link = await api.get<{ url: string }>(
        `/workspaces/${workspaceId}/exports/${exportId}/download`,
      );
      openLink(link.url);
    },
    onError: async (e) =>
      alertDialog(e instanceof ApiError ? e.message : 'Не удалось открыть выгрузку'),
  });

  const storage = workspace.data?.storage;

  return (
    <div className="pdr-stack">
      <h1 className="pdr-title">Выгрузка данных</h1>
      <div className="pdr-hint">
        Файлы в формате CSV открываются в Excel. Ссылка на выгрузку действует неделю, потом файл
        удаляется.
      </div>

      {storage ? (
        <Card>
          <div className="pdr-row">
            <span className="pdr-grow pdr-hint">Занято в хранилище</span>
            <span>
              {(storage.usedBytes / 1024 / 1024).toFixed(0)} из{' '}
              {(storage.quotaBytes / 1024 / 1024 / 1024).toFixed(0)} ГБ
            </span>
          </div>
          {storage.warn ? (
            <div className="pdr-hint" style={{ marginTop: 6 }}>
              Место заканчивается: удалите ненужные фотографии или обратитесь к администратору.
            </div>
          ) : null}
        </Card>
      ) : null}

      <Card>
        <label className="pdr-row" style={{ cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={includePhotos}
            onChange={(e) => setIncludePhotos(e.target.checked)}
          />
          <span className="pdr-grow">Вложить фотографии заказов (архив будет большим)</span>
        </label>
      </Card>

      <Button block loading={request.isPending} onClick={() => request.mutate('crm_full')}>
        Выгрузить всю базу
      </Button>
      <div className="pdr-row">
        <Button variant="secondary" block onClick={() => request.mutate('crm_clients')}>
          Клиенты
        </Button>
        <Button variant="secondary" block onClick={() => request.mutate('crm_orders')}>
          Заказы
        </Button>
        <Button variant="secondary" block onClick={() => request.mutate('crm_payments')}>
          Оплаты
        </Button>
      </div>

      <h2 className="pdr-subtitle">Последние выгрузки</h2>
      {exports.isLoading ? (
        <SkeletonList rows={2} />
      ) : (exports.data?.length ?? 0) === 0 ? (
        <EmptyState title="Выгрузок ещё не было" />
      ) : (
        <Card flat>
          <div className="pdr-list">
            {exports.data!.map((item) => (
              <ListItem
                key={item.id}
                title={KIND_LABELS[item.kind] ?? item.kind}
                subtitle={[
                  formatDateTime(item.createdAt),
                  item.rowCount !== null ? `${item.rowCount} строк` : null,
                  item.error,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                right={
                  <Badge
                    tone={
                      item.status === 'done'
                        ? 'success'
                        : item.status === 'failed'
                          ? 'danger'
                          : 'warning'
                    }
                  >
                    {STATUS_LABELS[item.status] ?? item.status}
                  </Badge>
                }
                onClick={item.ready ? () => download.mutate(item.id) : undefined}
              />
            ))}
          </div>
        </Card>
      )}

      <Button
        variant="secondary"
        block
        onClick={() => navigate(`/workspace/${workspaceId}/settings`)}
      >
        Назад
      </Button>
    </div>
  );
}
