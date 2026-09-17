import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  MediaUploader,
  SkeletonList,
  useUploadQueue,
} from '@pdr/ui';
import { api } from '@/shared/api';
import { createUploadTransport } from '@/shared/uploads';
import { photosPath, useDamages, useLeadPhotos, useOrderPhotos } from './api';
import { PhotoMarkupSheet } from './PhotoMarkupSheet';
import type { DamageParent } from './DamageSheet';
import { PHOTO_CATEGORY_OPTIONS, type OrderPhoto, type PhotoCategory } from './types';

/**
 * Фотографии заказа или обращения.
 *
 * Кнопка добавления — самая заметная на вкладке и открывает камеру сразу:
 * на мобильном снимок делают прямо у машины, а не выбирают из галереи.
 * Нажатие на снимок открывает разметку, а не просто увеличенную картинку:
 * отметить вмятину важнее, чем рассмотреть её.
 */
export function PhotosTab({
  workspaceId,
  parent,
  canEdit,
}: {
  workspaceId: string;
  parent: DamageParent;
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const leadId = 'leadId' in parent ? parent.leadId : '';
  const orderId = 'orderId' in parent ? parent.orderId : '';

  const leadPhotos = useLeadPhotos(workspaceId, leadId, Boolean(leadId));
  const orderPhotos = useOrderPhotos(workspaceId, orderId);
  const query = leadId ? leadPhotos : orderPhotos;
  const allPhotos: OrderPhoto[] = query.data?.items ?? [];

  const damages = useDamages(workspaceId, parent);

  const [category, setCategory] = useState<PhotoCategory>('before');
  const [opened, setOpened] = useState<OrderPhoto | null>(null);

  const invalidate = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['crm', 'photos'] });
  };

  const uploads = useUploadQueue({
    transport: createUploadTransport({ scope: 'order_photo', workspaceId }),
    onUploaded: async (fileId) => {
      // Категория берётся на момент загрузки: мастер снимает пачку в одном режиме.
      await api.post(photosPath(workspaceId, parent), { fileId, category });
      await invalidate();
    },
  });

  if (query.isLoading) return <SkeletonList rows={3} />;

  const items = allPhotos.filter((photo) => photo.category === category);

  return (
    <div className="pdr-stack">
      {canEdit ? (
        <Card>
          <MediaUploader
            items={uploads.items}
            onAdd={uploads.add}
            onRetry={uploads.retry}
            onRemove={uploads.remove}
            accept="image/*"
            capture
            label={`Добавить фото · ${PHOTO_CATEGORY_OPTIONS.find((o) => o.value === category)?.label}`}
            hint="Снимки загружаются в фоне: можно продолжать работу, не дожидаясь конца загрузки."
          />
        </Card>
      ) : null}

      {uploads.pending ? (
        <div className="pdr-hint">Идёт загрузка, не закрывайте приложение.</div>
      ) : null}

      <div className="pdr-chips">
        {PHOTO_CATEGORY_OPTIONS.map((option) => {
          const count = allPhotos.filter((photo) => photo.category === option.value).length;
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
              <button
                key={photo.id}
                type="button"
                style={{ all: 'unset', position: 'relative', cursor: 'pointer' }}
                onClick={() => setOpened(photo)}
              >
                {photo.thumbUrl ? (
                  <img
                    src={photo.thumbUrl}
                    alt={photo.caption ?? ''}
                    style={{
                      width: '100%',
                      aspectRatio: '1',
                      objectFit: 'cover',
                      borderRadius: 8,
                    }}
                  />
                ) : (
                  <div className="pdr-skeleton" style={{ aspectRatio: '1' }} />
                )}
                {photo.hasMarkup ? (
                  <span style={{ position: 'absolute', left: 4, bottom: 4 }}>
                    <Badge tone="info">разметка</Badge>
                  </span>
                ) : null}
              </button>
            ))}
          </div>
          <div className="pdr-hint" style={{ marginTop: 8 }}>
            Нажмите на снимок, чтобы отметить конкретное повреждение.
          </div>
        </Card>
      )}

      <PhotoMarkupSheet
        open={opened !== null}
        onClose={() => setOpened(null)}
        workspaceId={workspaceId}
        photo={opened}
        damages={damages.data?.items ?? []}
        canEdit={canEdit}
      />

      <Button variant="ghost" block onClick={() => void query.refetch()}>
        Обновить
      </Button>
    </div>
  );
}
