import { useEffect, useState } from 'react';
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
import { useFreshMarkupQueue, useMarkupAfterUpload } from './FreshPhotoMarkup';
import { DraftPhotoMarkupSheet, PhotoMarkupSheet } from './PhotoMarkupSheet';
import { PhotoThumb } from './PhotoThumb';
import { panelLabel } from '@pdr/shared';
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

  const markupAfterUpload = useMarkupAfterUpload(workspaceId, invalidate);
  const fresh = useFreshMarkupQueue();

  const uploads = useUploadQueue({
    transport: createUploadTransport({ scope: 'order_photo', workspaceId }),
    onUploaded: async (fileId, item) => {
      // Категория берётся на момент загрузки: мастер снимает пачку в одном режиме.
      const photo = await api.post<{ id: string }>(photosPath(workspaceId, parent), {
        fileId,
        category,
      });
      await invalidate();
      await markupAfterUpload.attached(item.localId, photo.id);
    },
  });

  // Сразу после съёмки — разметка: снимок ещё загружается, редактор уже открыт.
  const freshItem = uploads.items.find((item) => item.localId === fresh.current) ?? null;
  useEffect(() => {
    if (fresh.current && !freshItem) fresh.drop(fresh.current);
  }, [fresh, freshItem]);

  if (query.isLoading) return <SkeletonList rows={3} />;

  const items = allPhotos.filter((photo) => photo.category === category);

  return (
    <div className="pdr-stack">
      {canEdit ? (
        <Card>
          <MediaUploader
            items={uploads.items}
            onAdd={(files) => fresh.enqueue(uploads.add(files))}
            onRetry={uploads.retry}
            onRemove={uploads.remove}
            accept="image/*"
            capture
            cameraLabel="📷 Снять фото"
            galleryLabel="🖼 Выбрать из галереи"
            hint={`Раздел «${PHOTO_CATEGORY_OPTIONS.find((o) => o.value === category)?.label}». Снимки загружаются в фоне: можно продолжать работу, не дожидаясь конца загрузки.`}
            renderTileMedia={markupAfterUpload.renderTile}
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
              gridTemplateColumns: 'repeat(auto-fill, minmax(112px, 1fr))',
              gap: 8,
            }}
          >
            {items.map((photo) => (
              <div key={photo.id} className="pdr-stack" style={{ gap: 4 }}>
                <button
                  type="button"
                  style={{ all: 'unset', position: 'relative', cursor: 'pointer' }}
                  onClick={() => setOpened(photo)}
                >
                  <PhotoThumb photo={photo} />
                </button>
                {photo.hasMarkup ? <Badge tone="success">Зона отмечена</Badge> : null}
                {/* Действие названо словами: «нажмите на снимок» догадкой
                    остаётся ровно до тех пор, пока никто не нажал. */}
                <Button size="sm" variant="secondary" onClick={() => setOpened(photo)}>
                  {photo.hasMarkup ? 'Изменить зону' : 'Отметить зону ремонта'}
                </Button>
              </div>
            ))}
          </div>
          <div className="pdr-hint" style={{ marginTop: 8 }}>
            Разметка хранится отдельно от снимка: оригинал остаётся нетронутым.
          </div>
        </Card>
      )}

      <DraftPhotoMarkupSheet
        key={freshItem?.localId ?? 'none'}
        open={freshItem !== null && opened === null}
        onClose={() => {
          if (freshItem) fresh.drop(freshItem.localId);
        }}
        fresh
        workspaceId={workspaceId}
        src={freshItem?.previewUrl ?? null}
        name={freshItem?.localId ?? 'photo'}
        value={null}
        damageOptions={(damages.data?.items ?? []).map((damage) => ({
          value: damage.id,
          label: `${panelLabel(damage.panelCode)}${damage.comment ? ` — ${damage.comment}` : ''}`,
        }))}
        onSave={(value) => {
          if (freshItem) markupAfterUpload.save(freshItem.localId, value);
        }}
        onRemovePhoto={() => {
          if (freshItem) void markupAfterUpload.discard(freshItem.localId, uploads.remove);
        }}
      />

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
