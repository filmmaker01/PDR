import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@pdr/api-client';
import {
  DAMAGE_TYPES,
  SIZE_ZONE_CLASSES,
  panelLabel,
  sizeClassForDimensions,
  sizeClassLabel,
  sizeClassOption,
} from '@pdr/shared';
import {
  Button,
  Card,
  Field,
  Input,
  MediaUploader,
  Sheet,
  Textarea,
  useUploadQueue,
} from '@pdr/ui';
import { api } from '@/shared/api';
import { createUploadTransport } from '@/shared/uploads';
import { formatMinor, parseMajorToMinor } from '@/shared/format';
import { alertDialog, confirmDialog, haptic } from '@/shared/telegram';
import { photosPath, useDamagePhotos } from './api';
import { ACCESS_OPTIONS, MATERIAL_OPTIONS, type Damage, type DamageDraft } from './types';

export type DamageParent = { leadId: string } | { orderId: string };

function basePath(workspaceId: string, parent: DamageParent): string {
  return 'leadId' in parent
    ? `/workspaces/${workspaceId}/leads/${parent.leadId}/damages`
    : `/workspaces/${workspaceId}/orders/${parent.orderId}/damages`;
}

/** Сантиметры на экране, миллиметры в базе: мастер меряет рулеткой в сантиметрах. */
function mmToCm(mm: number | null | undefined): string {
  return mm === null || mm === undefined ? '' : String(Math.round(mm / 10));
}

function cmToMm(value: string): number | null {
  const n = Number(value.replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 10);
}

export interface DamageSheetProps {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
  parent: DamageParent;
  /** Деталь, выбранная на схеме кузова. */
  panelCode: string;
  /** Существующее повреждение, если открыли на правку. */
  damage?: Damage | null;
  canEdit: boolean;
  /**
   * Форма без сервера: обращение ещё не создано, повреждения копятся в
   * состоянии экрана и уходят вместе с обращением одним запросом.
   */
  draftMode?: boolean;
  onDraftSave?: (draft: DamageDraft) => void;
}

/**
 * Карточка повреждения выбранной детали.
 *
 * Одна деталь может быть повреждена несколько раз, поэтому карточка всегда
 * про конкретное повреждение, а не про деталь целиком: именно это позволяет
 * потом показать, какую из двух вмятин на двери согласовали в работу.
 */
export function DamageSheet({
  open,
  onClose,
  workspaceId,
  parent,
  panelCode,
  damage,
  canEdit,
  draftMode,
  onDraftSave,
}: DamageSheetProps) {
  const queryClient = useQueryClient();

  const [damageType, setDamageType] = useState<string>('');
  const [widthCm, setWidthCm] = useState('');
  const [heightCm, setHeightCm] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [material, setMaterial] = useState<'steel' | 'aluminum' | 'other' | ''>('');
  const [access, setAccess] = useState<'easy' | 'medium' | 'hard' | ''>('');
  const [onEdge, setOnEdge] = useState(false);
  const [comment, setComment] = useState('');
  const [price, setPrice] = useState('');

  useEffect(() => {
    if (!open) return;
    setDamageType(damage?.damageType ?? '');
    setWidthCm(mmToCm(damage?.widthMm));
    setHeightCm(mmToCm(damage?.heightMm));
    setQuantity(damage?.quantity ?? 1);
    setMaterial(damage?.material ?? '');
    setAccess(damage?.accessDifficulty ?? '');
    setOnEdge(damage?.onEdge ?? false);
    setComment(damage?.comment ?? '');
    setPrice(damage?.priceMinor ? String(damage.priceMinor / 100) : '');
  }, [open, damage]);

  const widthMm = cmToMm(widthCm);
  const heightMm = cmToMm(heightCm);
  const sizeClass = sizeClassForDimensions(widthMm, heightMm);

  const payload = (): DamageDraft & { priceMinor?: number | null } => ({
    panelCode,
    damageType: damageType || null,
    sizeClass,
    widthMm,
    heightMm,
    quantity,
    material: material || null,
    accessDifficulty: access || null,
    onEdge,
    comment: comment.trim() || null,
    priceMinor: price.trim() ? (parseMajorToMinor(price) ?? null) : null,
  });

  // Снимки конкретного повреждения: их снимают у детали и сюда же смотрят,
  // когда спорят, о какой именно вмятине речь.
  const photos = useDamagePhotos(workspaceId, parent, damage?.id ?? null, open);
  const uploads = useUploadQueue({
    transport: createUploadTransport({ scope: 'order_photo', workspaceId }),
    onUploaded: async (fileId) => {
      if (!damage) return;
      await api.post(photosPath(workspaceId, parent), {
        fileId,
        category: 'before',
        damageId: damage.id,
      });
      await queryClient.invalidateQueries({ queryKey: ['crm', 'photos'] });
      await queryClient.invalidateQueries({ queryKey: ['crm', 'damages'] });
    },
  });

  const invalidate = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['crm', 'damages'] });
    await queryClient.invalidateQueries({ queryKey: ['crm', 'lead'] });
    await queryClient.invalidateQueries({ queryKey: ['crm', 'order'] });
  };

  const save = useMutation({
    mutationFn: () =>
      damage
        ? api.patch(`/workspaces/${workspaceId}/damages/${damage.id}`, payload())
        : api.post(basePath(workspaceId, parent), payload()),
    onSuccess: async () => {
      haptic('success');
      await invalidate();
      onClose();
    },
    onError: async (e) => {
      haptic('error');
      await alertDialog(e instanceof ApiError ? e.message : 'Не удалось сохранить повреждение');
    },
  });

  const remove = useMutation({
    mutationFn: () => api.delete(`/workspaces/${workspaceId}/damages/${damage!.id}`),
    onSuccess: async () => {
      haptic('success');
      await invalidate();
      onClose();
    },
    onError: async (e) =>
      alertDialog(e instanceof ApiError ? e.message : 'Не удалось удалить повреждение'),
  });

  const submit = (): void => {
    if (draftMode) {
      onDraftSave?.(payload());
      onClose();
      return;
    }
    save.mutate();
  };

  return (
    <Sheet open={open} onClose={onClose} title={panelLabel(panelCode) ?? 'Повреждение'}>
      <div className="pdr-stack">
        <Field label="Тип повреждения">
          <div className="pdr-chips">
            {DAMAGE_TYPES.map((type) => (
              <button
                key={type.code}
                type="button"
                disabled={!canEdit}
                className={`pdr-chip${damageType === type.code ? ' pdr-chip--active' : ''}`}
                onClick={() => setDamageType(damageType === type.code ? '' : type.code)}
              >
                {type.label}
              </button>
            ))}
          </div>
        </Field>

        <Card flat>
          {/* Готовые зоны: мастер выбирает 40×40 одним нажатием и сразу видит,
              как меняется стоимость. Точные габариты можно ввести и руками. */}
          <Field label="Размер зоны">
            <div className="pdr-chips">
              {SIZE_ZONE_CLASSES.map((zone) => (
                <button
                  key={zone.code}
                  type="button"
                  disabled={!canEdit}
                  className={`pdr-chip${sizeClass === zone.code ? ' pdr-chip--active' : ''}`}
                  onClick={() => {
                    setWidthCm(String(zone.widthCm));
                    setHeightCm(String(zone.heightCm));
                  }}
                >
                  {zone.label}
                </button>
              ))}
            </div>
          </Field>
          <div className="pdr-row">
            <Field label="Ширина, см">
              <Input
                value={widthCm}
                onChange={(e) => setWidthCm(e.target.value)}
                inputMode="decimal"
                placeholder="40"
                disabled={!canEdit}
              />
            </Field>
            <Field label="Высота, см">
              <Input
                value={heightCm}
                onChange={(e) => setHeightCm(e.target.value)}
                inputMode="decimal"
                placeholder="40"
                disabled={!canEdit}
              />
            </Field>
          </div>
          <div className="pdr-hint">
            {sizeClass
              ? `Размерный класс: ${sizeClassLabel(sizeClass)}${
                  sizeClassOption(sizeClass) ? ` · ${sizeClassOption(sizeClass)!.hint}` : ''
                }`
              : 'Размерный класс определится по габаритам'}
          </div>
        </Card>

        <Field label="Количество вмятин">
          <Input
            type="number"
            min={1}
            max={500}
            value={quantity}
            onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))}
            disabled={!canEdit}
          />
        </Field>

        <Field label="Материал">
          <div className="pdr-chips">
            {MATERIAL_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                disabled={!canEdit}
                className={`pdr-chip${material === option.value ? ' pdr-chip--active' : ''}`}
                onClick={() => setMaterial(material === option.value ? '' : option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Доступ">
          <div className="pdr-chips">
            {ACCESS_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                disabled={!canEdit}
                className={`pdr-chip${access === option.value ? ' pdr-chip--active' : ''}`}
                onClick={() => setAccess(access === option.value ? '' : option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </Field>

        <label className="pdr-row" style={{ cursor: canEdit ? 'pointer' : 'default' }}>
          <input
            type="checkbox"
            checked={onEdge}
            disabled={!canEdit}
            onChange={(e) => setOnEdge(e.target.checked)}
          />
          <span className="pdr-grow">На ребре жёсткости</span>
        </label>

        <Field label="Комментарий">
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={2}
            disabled={!canEdit}
            placeholder="Что именно отдаём в работу"
          />
        </Field>

        {!draftMode ? (
          <Field label="Стоимость" hint="Можно оставить пустым и посчитать при оценке">
            <Input
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              inputMode="decimal"
              placeholder="0"
              disabled={!canEdit}
            />
          </Field>
        ) : null}

        {damage && !draftMode ? (
          <>
            <div className="pdr-hint">Фотографии этого повреждения</div>
            {photos.length > 0 ? (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))',
                  gap: 6,
                }}
              >
                {photos.map((photo) =>
                  photo.thumbUrl ? (
                    <img
                      key={photo.id}
                      src={photo.thumbUrl}
                      alt=""
                      style={{
                        width: '100%',
                        aspectRatio: '1',
                        objectFit: 'cover',
                        borderRadius: 6,
                      }}
                    />
                  ) : (
                    <div key={photo.id} className="pdr-skeleton" style={{ aspectRatio: '1' }} />
                  ),
                )}
              </div>
            ) : null}
            {canEdit ? (
              <MediaUploader
                items={uploads.items}
                onAdd={uploads.add}
                onRetry={uploads.retry}
                onRemove={uploads.remove}
                accept="image/*"
                capture
                cameraLabel="📷 Снять фото"
                galleryLabel="🖼 Выбрать из галереи"
                hint="Снимок привяжется к этому повреждению. Разметить вмятину можно на вкладке «Фото»."
              />
            ) : null}
          </>
        ) : null}

        {damage?.priceMinor ? (
          <div className="pdr-hint">
            Текущая стоимость: {formatMinor(damage.priceMinor, 'RUB')}
            {damage.priceSource === 'ai' ? ' · предварительная AI-оценка' : ''}
          </div>
        ) : null}

        {canEdit ? (
          <Button block loading={save.isPending} onClick={submit}>
            {damage ? 'Сохранить' : 'Отметить повреждение'}
          </Button>
        ) : null}

        {damage && canEdit ? (
          <Button
            variant="danger"
            block
            loading={remove.isPending}
            onClick={async () => {
              if (await confirmDialog('Снять отметку повреждения?')) remove.mutate();
            }}
          >
            Удалить
          </Button>
        ) : null}

        <Button variant="secondary" block onClick={onClose}>
          Закрыть
        </Button>
      </div>
    </Sheet>
  );
}
