import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
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
 * Разметка снимка, сделанная до того, как обращение или заказ сохранены.
 *
 * Оригинал уже загружен, но в базе его ещё нет — поэтому разметка живёт
 * рядом с ним в форме, а при создании записи уходит вместе со снимком.
 * Повреждение тоже может быть ещё не сохранено: тогда снимок привязывается
 * к нему по локальному ключу, а номер в базе появится при создании.
 */
export interface DraftPhotoMarkup {
  annotation: MarkupDoc | null;
  /** Сведённая картинка — отдельный файл, оригинал не меняется. */
  annotationFileId: string | null;
  /** Локальный ключ повреждения из этой же формы или null — «не привязано». */
  damageKey: string | null;
}

export function draftHasMarkup(value: DraftPhotoMarkup | null | undefined): boolean {
  return Boolean(value?.annotation && value.annotation.shapes.length > 0);
}

interface DamageOption {
  value: string;
  label: string;
}

/**
 * Сведение разметки с оригиналом для печати и выгрузки.
 * Не удалось — не беда: векторная разметка всё равно сохранится.
 */
async function flattenMarkup(
  src: string,
  markup: MarkupDoc,
  name: string,
  workspaceId: string,
): Promise<string | null> {
  if (markup.shapes.length === 0) return null;
  try {
    const blob = await renderMarkupToBlob(src, markup);
    return await uploadBlob(blob, name, { scope: 'order_photo', workspaceId });
  } catch {
    return null;
  }
}

/**
 * Сам редактор: снимок с кистью, обводкой и стрелкой, привязка к
 * повреждению и кнопки. Откуда снимок и куда сохранять — решает обёртка:
 * сохранённая фотография или снимок из формы нового обращения.
 */
function MarkupEditorSheet({
  open,
  onClose,
  src,
  loading,
  initialMarkup,
  initialDamageId,
  damageOptions,
  hasMarkup,
  canEdit,
  onSave,
  onRemovePhoto,
}: {
  open: boolean;
  onClose: () => void;
  src: string | null;
  loading: boolean;
  initialMarkup: MarkupDoc | null;
  initialDamageId: string;
  damageOptions: DamageOption[];
  hasMarkup: boolean;
  canEdit: boolean;
  onSave: (markup: MarkupDoc, damageId: string) => Promise<void>;
  onRemovePhoto: () => Promise<void>;
}) {
  const [markup, setMarkup] = useState<MarkupDoc>(EMPTY_MARKUP);
  const [damageId, setDamageId] = useState('');
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMarkup(initialMarkup ?? EMPTY_MARKUP);
    setDamageId(initialDamageId);
    // Разметка и привязка берутся заново только при открытии: правки
    // мастера не должны сбрасываться, пока он рисует.
  }, [open]);

  const save = async (): Promise<void> => {
    setSaving(true);
    try {
      await onSave(markup, damageId);
      haptic('success');
      onClose();
    } catch (e) {
      haptic('error');
      await alertDialog(e instanceof ApiError ? e.message : 'Не удалось сохранить разметку');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (): Promise<void> => {
    if (!(await confirmDialog('Удалить фотографию вместе с разметкой?'))) return;
    setRemoving(true);
    try {
      await onRemovePhoto();
      haptic('success');
      onClose();
    } catch (e) {
      await alertDialog(e instanceof ApiError ? e.message : 'Не удалось удалить фотографию');
    } finally {
      setRemoving(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Зона ремонта на фотографии">
      <div className="pdr-stack">
        {hasMarkup ? <Badge tone="success">Зона отмечена</Badge> : null}
        <div className="pdr-hint">
          Обведите вмятину, нарисуйте или поставьте стрелку. Оригинал снимка не меняется: разметка
          хранится отдельно и её всегда можно поправить.
        </div>

        {loading || !src ? (
          <div className="pdr-row" style={{ justifyContent: 'center', padding: 24 }}>
            <Spinner />
          </div>
        ) : (
          <PhotoMarkup src={src} value={markup} onChange={setMarkup} disabled={!canEdit} />
        )}

        {damageOptions.length > 0 ? (
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
                {damageOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>
          </Card>
        ) : null}

        {canEdit ? (
          <Button block loading={saving} disabled={!src} onClick={() => void save()}>
            Сохранить зону
          </Button>
        ) : null}

        {canEdit ? (
          <Button variant="danger" block loading={removing} onClick={() => void remove()}>
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

/**
 * Просмотр сохранённого снимка и разметка повреждения на нём.
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
  defaultDamageId,
  canEdit,
}: {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
  photo: OrderPhoto | null;
  damages: Damage[];
  /** Деталь, из карточки которой открыли снимок: привязка уже известна. */
  defaultDamageId?: string | null;
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !photo) return;
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

  if (!photo) return null;

  return (
    <MarkupEditorSheet
      open={open}
      onClose={onClose}
      src={originalUrl}
      loading={loading}
      initialMarkup={photo.annotation}
      initialDamageId={photo.damageId ?? defaultDamageId ?? ''}
      damageOptions={damages.map((damage) => ({
        value: damage.id,
        label: `${panelLabel(damage.panelCode)}${damage.comment ? ` — ${damage.comment}` : ''}`,
      }))}
      hasMarkup={photo.hasMarkup}
      canEdit={canEdit}
      onSave={async (markup, damageId) => {
        const annotationFileId = originalUrl
          ? await flattenMarkup(originalUrl, markup, `markup-${photo.id}.jpg`, workspaceId)
          : null;

        await api.post(`/workspaces/${workspaceId}/photos/${photo.id}/markup`, {
          annotation: markup.shapes.length > 0 ? markup : null,
          ...(annotationFileId ? { annotationFileId } : {}),
        });

        if (damageId !== (photo.damageId ?? '')) {
          await api.patch(`/workspaces/${workspaceId}/photos/${photo.id}`, {
            damageId: damageId || null,
          });
        }
        await invalidate();
      }}
      onRemovePhoto={async () => {
        await api.delete(`/workspaces/${workspaceId}/photos/${photo.id}`);
        await invalidate();
      }}
    />
  );
}

/**
 * Разметка снимка из формы нового обращения или заказа.
 *
 * Тот же редактор, что и во вкладке «Фото». Разница только в том, куда
 * уходит результат: не в базу, а в состояние формы — до её сохранения.
 */
export function DraftPhotoMarkupSheet({
  open,
  onClose,
  workspaceId,
  src,
  name,
  value,
  damageOptions,
  onSave,
  onRemovePhoto,
}: {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
  /** Локальная ссылка на снимок с устройства. */
  src: string | null;
  name: string;
  value: DraftPhotoMarkup | null;
  damageOptions: DamageOption[];
  onSave: (value: DraftPhotoMarkup) => void;
  onRemovePhoto: () => void;
}) {
  return (
    <MarkupEditorSheet
      open={open}
      onClose={onClose}
      src={src}
      loading={false}
      initialMarkup={value?.annotation ?? null}
      initialDamageId={value?.damageKey ?? ''}
      damageOptions={damageOptions}
      hasMarkup={draftHasMarkup(value)}
      canEdit
      onSave={async (markup, damageKey) => {
        const annotationFileId = src
          ? await flattenMarkup(src, markup, `markup-${name}.jpg`, workspaceId)
          : null;
        onSave({
          annotation: markup.shapes.length > 0 ? markup : null,
          annotationFileId,
          damageKey: damageKey || null,
        });
      }}
      onRemovePhoto={async () => onRemovePhoto()}
    />
  );
}
