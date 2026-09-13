import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@pdr/api-client';
import { Badge, Button, Card, EmptyState, ListItem, SkeletonList } from '@pdr/ui';
import { api } from '@/shared/api';
import { formatDateTime, formatMinor } from '@/shared/format';
import { alertDialog, haptic } from '@/shared/telegram';
import { useEstimates } from './api';
import { ESTIMATE_STATUS_TONES, type Estimate } from './types';

/** Вкладка «Расчёт» в карточке заказа: версии сметы и действия по ним. */
export function EstimatesTab({
  workspaceId,
  orderId,
  canEdit,
}: {
  workspaceId: string;
  orderId: string;
  canEdit: boolean;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const estimates = useEstimates(workspaceId, orderId);

  const invalidate = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['crm'] });
  };

  const createDraft = useMutation({
    mutationFn: () =>
      api.post<{ id: string }>(`/workspaces/${workspaceId}/orders/${orderId}/estimates`, {}),
    onSuccess: async (created) => {
      haptic('success');
      await invalidate();
      navigate(`/workspace/${workspaceId}/estimates/${created.id}`);
    },
    onError: async (e) => {
      haptic('error');
      if (e instanceof ApiError && e.code === 'conflict') {
        const details = e.details as { estimateId?: string } | undefined;
        if (details?.estimateId) {
          navigate(`/workspace/${workspaceId}/estimates/${details.estimateId}`);
          return;
        }
      }
      await alertDialog(e instanceof ApiError ? e.message : 'Не удалось создать смету');
    },
  });

  const newVersion = useMutation({
    mutationFn: (estimateId: string) =>
      api.post<{ id: string }>(`/workspaces/${workspaceId}/estimates/${estimateId}/new-version`),
    onSuccess: async (created) => {
      haptic('success');
      await invalidate();
      navigate(`/workspace/${workspaceId}/estimates/${created.id}`);
    },
    onError: async (e) =>
      alertDialog(e instanceof ApiError ? e.message : 'Не удалось создать новую версию'),
  });

  if (estimates.isLoading) return <SkeletonList rows={3} />;

  const items = estimates.data ?? [];
  const agreed = items.find((estimate) => estimate.status === 'agreed');
  const draft = items.find((estimate) => estimate.status === 'draft');
  const latest = items[0];

  return (
    <div className="pdr-stack">
      {agreed ? (
        <Card>
          <div className="pdr-row">
            <span className="pdr-grow">
              <span className="pdr-hint">Согласованная сумма</span>
              <span style={{ display: 'block', fontSize: 22, fontWeight: 700 }}>
                {formatMinor(agreed.totalMinor, agreed.currency)}
              </span>
              <span className="pdr-hint">
                версия {agreed.versionNo}
                {agreed.agreedAt ? `, ${formatDateTime(agreed.agreedAt)}` : ''}
              </span>
            </span>
          </div>
        </Card>
      ) : null}

      {items.length === 0 ? (
        <EmptyState
          title="Сметы нет"
          description="Составьте расчёт: позиции из прайса или вручную, скидка и итог считаются на сервере."
        />
      ) : (
        <Card flat>
          <div className="pdr-list">
            {items.map((estimate: Estimate) => (
              <ListItem
                key={estimate.id}
                title={`Версия ${estimate.versionNo} · ${formatMinor(estimate.totalMinor, estimate.currency)}`}
                subtitle={[
                  `${estimate.items.length} позиц.`,
                  estimate.discountMinor > 0
                    ? `скидка ${formatMinor(estimate.discountMinor, estimate.currency)}`
                    : null,
                  formatDateTime(estimate.createdAt),
                ]
                  .filter(Boolean)
                  .join(' · ')}
                right={
                  <Badge tone={ESTIMATE_STATUS_TONES[estimate.status]}>
                    {estimate.statusLabel}
                  </Badge>
                }
                onClick={() => navigate(`/workspace/${workspaceId}/estimates/${estimate.id}`)}
              />
            ))}
          </div>
        </Card>
      )}

      {canEdit ? (
        draft ? (
          <Button block onClick={() => navigate(`/workspace/${workspaceId}/estimates/${draft.id}`)}>
            Продолжить черновик (версия {draft.versionNo})
          </Button>
        ) : items.length === 0 ? (
          <Button block loading={createDraft.isPending} onClick={() => createDraft.mutate()}>
            Новая смета
          </Button>
        ) : latest ? (
          <Button
            block
            loading={newVersion.isPending}
            onClick={() => newVersion.mutate((agreed ?? latest).id)}
          >
            Новая версия
          </Button>
        ) : null
      ) : null}
    </div>
  );
}
