import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@pdr/api-client';
import { Button, Card, EmptyState, MediaUploader, SkeletonList, useUploadQueue } from '@pdr/ui';
import { api } from '@/shared/api';
import { createUploadTransport } from '@/shared/uploads';
import { alertDialog, confirmDialog, haptic } from '@/shared/telegram';
import { useOrderPhotos } from './api';
import { PHOTO_CATEGORY_OPTIONS, type PhotoCategory } from './types';

/** Вкладка «Фото»: снимки «до / в процессе / после» и документы. */
export function PhotosTab({
  workspaceId,
  orderId,
  canEdit,
}: {
  workspaceId: string;
  orderId: string;
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const photos = useOrderPhotos(workspaceId, orderId);
  const [category, setCategory] = useState<PhotoCategory>('before');

  const invalidate = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['crm', 'photos'] });
  };

  const uploads = useUploadQueue({
    transport: createUploadTransport({ scope: 'order_photo', workspaceId }),
    onUploaded: async (fileId) => {
      // Категория берётся на момент загрузки: мастер снимает пачку в одном режиме.
      await api.post(`/workspaces/${workspaceId}/orders/${orderId}/photos`, { fileId, category });
      await invalidate();
    },
  });

  const remove = useMutation({
    mutationFn: (photoId: string) =>
      api.delete(`/workspaces/${workspaceId}/orders/${orderId}/photos/${photoId}`),
    onSuccess: async () => {
      haptic('success');
      await invalidate();
    },
    onError: async (e) =>
      alertDialog(e instanceof ApiError ? e.message : 'Не удалось удалить фотографию'),
  });

  const openOriginal = useMutation({
    mutationFn: async (photoId: string) => {
      const { url } = await api.get<{ url: string }>(
        `/workspaces/${workspaceId}/orders/${orderId}/photos/${photoId}/download`,
      );
      window.open(url, '_blank');
    },
    onError: async (e) =>
      alertDialog(e instanceof ApiError ? e.message : 'Не удалось открыть фотографию'),
  });

  if (photos.isLoading) return <SkeletonList rows={3} />;

  const items = (photos.data?.items ?? []).filter((photo) => photo.category === category);

  return (
    <div className="pdr-stack">
      <div className="pdr-chips">
        {PHOTO_CATEGORY_OPTIONS.map((option) => {
          const count = (photos.data?.items ?? []).filter(
            (photo) => photo.category === option.value,
          ).length;
          return (
            <button
              key={option.value}
              type="button"
              className={`pdr-chip${category === option.value ? ' pdr-chip--active' : ''}`}
              onClick={() => setCategory(option.value)}
            >
              {option.label}
              {count > 0 ? ` · ${count}` : ''}
            </button>
          );
        })}
      </div>

      {items.length === 0 ? (
        <EmptyState
          title="Снимков нет"
          description="Снимите повреждения до работы, ход ремонта и результат."
        />
      ) : (
        <Card>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))',
              gap: 8,
            }}
          >
            {items.map((photo) => (
              <div key={photo.id} style={{ position: 'relative' }}>
                {photo.thumbUrl ? (
                  <img
                    src={photo.thumbUrl}
                    alt={photo.caption ?? ''}
                    style={{
                      width: '100%',
                      aspectRatio: '1',
                      objectFit: 'cover',
                      borderRadius: 8,
                      cursor: 'pointer',
                    }}
                    onClick={() => openOriginal.mutate(photo.id)}
                  />
                ) : (
                  <div className="pdr-skeleton" style={{ aspectRatio: '1' }} />
                )}
                {canEdit ? (
                  <button
                    type="button"
                    className="pdr-uploader__remove"
                    aria-label="Удалить"
                    onClick={async () => {
                      if (await confirmDialog('Удалить фотографию?')) remove.mutate(photo.id);
                    }}
                  >
                    ×
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </Card>
      )}

      {canEdit ? (
        <Card>
          <MediaUploader
            items={uploads.items}
            onAdd={uploads.add}
            onRetry={uploads.retry}
            onRemove={uploads.remove}
            accept="image/*"
            capture
            label={`Добавить «${PHOTO_CATEGORY_OPTIONS.find((o) => o.value === category)?.label}»`}
            hint="Снимки загружаются в фоне: можно продолжать работу, не дожидаясь конца загрузки."
          />
        </Card>
      ) : null}

      {uploads.pending ? (
        <div className="pdr-hint">Идёт загрузка, не закрывайте приложение.</div>
      ) : null}

      <Button variant="ghost" block onClick={() => void photos.refetch()}>
        Обновить
      </Button>
    </div>
  );
}
