import { useEffect, useState } from 'react';
import { damageTypeLabel, describeDamageSize, panelLabel } from '@pdr/shared';
import { Badge, Button, MediaUploader, useUploadQueue } from '@pdr/ui';
import { createUploadTransport } from '@/shared/uploads';
import { useFreshMarkupQueue } from './FreshPhotoMarkup';
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
 * Файлы загружаются сразу, а к записи привязываются при её создании. Сразу
 * после съёмки или выбора открывается разметка зоны ремонта; под каждой
 * миниатюрой остаётся кнопка «Изменить зону», чтобы поправить её позже.
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
  // Ручное открытие («Изменить зону») важнее очереди свежих снимков.
  const [openedId, setOpenedId] = useState<string | null>(null);
  const fresh = useFreshMarkupQueue();
  const activeId = openedId ?? fresh.current;
  const isFresh = openedId === null && fresh.current !== null;
  const opened = photos.uploads.items.find((item) => item.localId === activeId) ?? null;

  // Снимок убрали крестиком, пока он ждал разметки: очередь не должна застрять.
  useEffect(() => {
    if (fresh.current && !photos.uploads.items.some((item) => item.localId === fresh.current)) {
      fresh.drop(fresh.current);
    }
  }, [fresh, photos.uploads.items]);

  const close = (): void => {
    if (isFresh && fresh.current) fresh.drop(fresh.current);
    else setOpenedId(null);
  };

  return (
    <>
      <MediaUploader
        items={photos.uploads.items}
        onAdd={(files) => fresh.enqueue(photos.uploads.add(files))}
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
        key={opened?.localId ?? 'none'}
        open={opened !== null}
        onClose={close}
        fresh={isFresh}
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
          // Из очереди свежих снимков его уберёт закрытие редактора.
          if (opened) photos.remove(opened.localId);
        }}
      />
    </>
  );
}
