import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@pdr/api-client';
import { panelLabel } from '@pdr/shared';
import {
  Badge,
  Button,
  Card,
  EMPTY_MARKUP,
  Field,
  PhotoMarkup,
  Sheet,
  Spinner,
  renderMarkupToBlob,
  type MarkupDoc,
} from '@pdr/ui';
import { api } from '@/shared/api';
import { uploadBlob } from '@/shared/uploads';
import { alertDialog, confirmDialog, haptic } from '@/shared/telegram';
import type { Damage, OrderPhoto } from './types';

/**
 * Просмотр снимка и разметка повреждения на нём.
 *
 * Оригинал загружается отдельной подписанной ссылкой и никогда не
 * перезаписывается. Сохраняются две вещи: векторная разметка (её можно
 * поправить позже) и сведённая картинка (её кладут в смету и выгрузку).
 * Поэтому в споре «эту вмятину согласовывали или соседнюю» видно и то,
 * как деталь выглядела, и что именно обвели.
 */
export function PhotoMarkupSheet({
  open,
  onClose,
  workspaceId,
  photo,
  damages,
  canEdit,
}: {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
  photo: OrderPhoto | null;
  damages: Damage[];
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const [markup, setMarkup] = useState<MarkupDoc>(EMPTY_MARKUP);
  const [damageId, setDamageId] = useState<string>('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !photo) return;
    setMarkup(photo.annotation ?? EMPTY_MARKUP);
    setDamageId(photo.damageId ?? '');
    setOriginalUrl(null);
    setLoading(true);

    let cancelled = false;
    api
      .get<{ url: string }>(`/workspaces/${workspaceId}/photos/${photo.id}/download`)
      .then((result) => {
        if (!cancelled) setOriginalUrl(result.url);
      })
      .catch(() => {
        if (!cancelled) void alertDialog('Не удалось открыть фотографию');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, photo, workspaceId]);

  const invalidate = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['crm', 'photos'] });
    await queryClient.invalidateQueries({ queryKey: ['crm', 'damages'] });
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!photo) return;

      let annotationFileId: string | null = null;
      if (markup.shapes.length > 0 && originalUrl) {
        try {
          const blob = await renderMarkupToBlob(originalUrl, markup);
          annotationFileId = await uploadBlob(blob, `markup-${photo.id}.jpg`, {
            scope: 'order_photo',
            workspaceId,
          });
        } catch {
          // Сведение — удобство для печати, а не условие сохранения:
          // векторная разметка всё равно сохранится и будет видна в приложении.
          annotationFileId = null;
        }
      }

      await api.post(`/workspaces/${workspaceId}/photos/${photo.id}/markup`, {
        annotation: markup.shapes.length > 0 ? markup : null,
        ...(annotationFileId ? { annotationFileId } : {}),
      });

      if (damageId !== (photo.damageId ?? '')) {
        await api.patch(`/workspaces/${workspaceId}/photos/${photo.id}`, {
          damageId: damageId || null,
        });
      }
    },
    onSuccess: async () => {
      haptic('success');
      await invalidate();
      onClose();
    },
    onError: async (e) => {
      haptic('error');
      await alertDialog(e instanceof ApiError ? e.message : 'Не удалось сохранить разметку');
    },
  });

  const remove = useMutation({
    mutationFn: () => api.delete(`/workspaces/${workspaceId}/photos/${photo!.id}`),
    onSuccess: async () => {
      haptic('success');
      await invalidate();
      onClose();
    },
    onError: async (e) =>
      alertDialog(e instanceof ApiError ? e.message : 'Не удалось удалить фотографию'),
  });

  if (!photo) return null;

  return (
    <Sheet open={open} onClose={onClose} title="Разметка повреждения">
      <div className="pdr-stack">
        {photo.hasMarkup ? <Badge tone="info">Разметка сохранена</Badge> : null}

        {loading || !originalUrl ? (
          <div className="pdr-row" style={{ justifyContent: 'center', padding: 24 }}>
            <Spinner />
          </div>
        ) : (
          <PhotoMarkup src={originalUrl} value={markup} onChange={setMarkup} disabled={!canEdit} />
        )}

        {damages.length > 0 ? (
          <Card>
            <Field
              label="К какому повреждению относится"
              hint="Нужно, когда на одной детали несколько вмятин"
            >
              <select
                className="pdr-select"
                value={damageId}
                disabled={!canEdit}
                onChange={(e) => setDamageId(e.target.value)}
              >
                <option value="">Не привязано</option>
                {damages.map((damage) => (
                  <option key={damage.id} value={damage.id}>
                    {panelLabel(damage.panelCode)}
                    {damage.comment ? ` — ${damage.comment}` : ''}
                  </option>
                ))}
              </select>
            </Field>
          </Card>
        ) : null}

        {canEdit ? (
          <Button block loading={save.isPending} onClick={() => save.mutate()}>
            Сохранить разметку
          </Button>
        ) : null}

        {canEdit ? (
          <Button
            variant="danger"
            block
            loading={remove.isPending}
            onClick={async () => {
              if (await confirmDialog('Удалить фотографию вместе с разметкой?')) remove.mutate();
            }}
          >
            Удалить фотографию
          </Button>
        ) : null}

        <Button variant="secondary" block onClick={onClose}>
          Закрыть
        </Button>
      </div>
    </Sheet>
  );
}
