import { useState } from 'react';
import { damageTypeLabel, describeDamageSize, panelLabel } from '@pdr/shared';
import { Badge, Button, MediaUploader, useUploadQueue } from '@pdr/ui';
import { createUploadTransport } from '@/shared/uploads';
import { DraftPhotoMarkupSheet, draftHasMarkup, type DraftPhotoMarkup } from './PhotoMarkupSheet';
import type { DamageDraft, PhotoCategory } from './types';

/**
 * Повреждение из формы, ещё не сохранённое в базе.
 *
 * Ключ нужен снимкам: разметку привязывают к повреждению раньше, чем у
 * него появится номер в базе. Уходит на сервер повреждение без ключа.
 */
export type DraftDamage = DamageDraft & { key: string };

export function withDraftKey(draft: DamageDraft): DraftDamage {
  return { ...draft, key: crypto.randomUUID() };
}

export function withoutDraftKey({ key: _key, ...draft }: DraftDamage): DamageDraft {
  return draft;
}

/** Снимок из формы, готовый к прикреплению вместе с разметкой. */
export interface DraftPhotoPayload {
  fileId: string;
  category: PhotoCategory;
  /** Ключ повреждения из формы или null. */
  damageKey: string | null;
  annotation: DraftPhotoMarkup['annotation'];
  annotationFileId: string | null;
}

/**
 * Снимки формы нового обращения или заказа и их разметка.
 *
 * Файлы загружаются сразу, а к записи привязываются при её создании. Под
 * каждой миниатюрой — та же кнопка разметки, что во вкладке «Фото», чтобы
 * отметить вмятину можно было прямо у машины, до сохранения формы.
 */
export function useDraftPhotos(workspaceId: string) {
  const uploads = useUploadQueue({
    transport: createUploadTransport({ scope: 'order_photo', workspaceId }),
  });
  const [markups, setMarkups] = useState<Record<string, DraftPhotoMarkup>>({});

  const remove = (localId: string): void => {
    uploads.remove(localId);
    setMarkups(({ [localId]: _removed, ...rest }) => rest);
  };

  /** Загруженные снимки: неудачные и отменённые в запись не попадают. */
  const payload = (): DraftPhotoPayload[] =>
    uploads.items
      .filter((item) => item.status === 'done' && item.fileId)
      .map((item) => {
        const markup = markups[item.localId];
        return {
          fileId: item.fileId!,
          category: 'before',
          damageKey: markup?.damageKey ?? null,
          annotation: draftHasMarkup(markup) ? markup!.annotation : null,
          annotationFileId: draftHasMarkup(markup) ? markup!.annotationFileId : null,
        };
      });

  return { uploads, markups, setMarkups, remove, payload };
}

export type DraftPhotos = ReturnType<typeof useDraftPhotos>;

function damageOptionLabel(damage: DraftDamage): string {
  const details = [
    damageTypeLabel(damage.damageType),
    describeDamageSize(damage.widthMm, damage.heightMm, damage.sizeClass).actual,
  ]
    .filter(Boolean)
    .join(' · ');
  return `${panelLabel(damage.panelCode) ?? damage.panelCode}${details ? ` — ${details}` : ''}`;
}

export function DraftPhotoUploader({
  workspaceId,
  photos,
  damages,
  hint,
}: {
  workspaceId: string;
  photos: DraftPhotos;
  damages: DraftDamage[];
  hint: string;
}) {
  const [openedId, setOpenedId] = useState<string | null>(null);
  const opened = photos.uploads.items.find((item) => item.localId === openedId) ?? null;

  return (
    <>
      <MediaUploader
        items={photos.uploads.items}
        onAdd={photos.uploads.add}
        onRetry={photos.uploads.retry}
        onRemove={photos.remove}
        accept="image/*"
        capture
        cameraLabel="📷 Снять фото"
        galleryLabel="🖼 Выбрать из галереи"
        hint={hint}
        renderTileFooter={(item) => {
          if (item.status === 'error' || item.status === 'cancelled') return null;
          const marked = draftHasMarkup(photos.markups[item.localId]);
          return (
            <>
              {marked ? <Badge tone="success">Зона отмечена</Badge> : null}
              <Button size="sm" variant="secondary" onClick={() => setOpenedId(item.localId)}>
                {marked ? 'Изменить зону' : 'Отметить зону ремонта'}
              </Button>
            </>
          );
        }}
      />

      <DraftPhotoMarkupSheet
        open={opened !== null}
        onClose={() => setOpenedId(null)}
        workspaceId={workspaceId}
        src={opened?.previewUrl ?? null}
        name={opened?.localId ?? 'photo'}
        value={opened ? (photos.markups[opened.localId] ?? null) : null}
        damageOptions={damages.map((damage) => ({
          value: damage.key,
          label: damageOptionLabel(damage),
        }))}
        onSave={(value) => {
          if (!opened) return;
          photos.setMarkups((current) => ({ ...current, [opened.localId]: value }));
        }}
        onRemovePhoto={() => {
          if (opened) photos.remove(opened.localId);
        }}
      />
    </>
  );
}
