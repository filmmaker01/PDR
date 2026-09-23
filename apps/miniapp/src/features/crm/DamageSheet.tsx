import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@pdr/api-client';
import {
  DAMAGE_TYPES,
  SIZE_ZONE_CLASSES,
  describeDamageSize,
  panelLabel,
  sizeClassForDimensions,
} from '@pdr/shared';
import {
  Badge,
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
import { ExtraWorkPickerSheet } from './ExtraWorkPicker';
import { PhotoMarkupSheet } from './PhotoMarkupSheet';
import {
  ACCESS_OPTIONS,
  MATERIAL_OPTIONS,
  type AssessmentPreview,
  type Damage,
  type DamageDraft,
  type DamageExtraWorkDraft,
  type OrderPhoto,
} from './types';

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
  currency?: string;
}

/**
 * Карточка повреждения выбранной детали.
 *
 * Одна деталь может быть повреждена несколько раз, поэтому карточка всегда
 * про конкретное повреждение, а не про деталь целиком: именно это позволяет
 * потом показать, какую из двух вмятин на двери согласовали в работу.
 *
 * Цена считается прямо здесь и обновляется на каждое изменение параметров:
 * мастер называет её клиенту у машины, а не после отдельного похода в оценку.
 * Считает сервер тем же расчётом, что и оценка, — второго калькулятора нет.
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
  currency = 'RUB',
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
  const [extraWorks, setExtraWorks] = useState<DamageExtraWorkDraft[]>([]);
  const [workPickerOpen, setWorkPickerOpen] = useState(false);
  const [markupPhoto, setMarkupPhoto] = useState<OrderPhoto | null>(null);
  const [preview, setPreview] = useState<AssessmentPreview | null>(null);

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
    // Ручная цена показывается, только если она и была ручной: расчётную сумму
    // в поле подставлять нельзя, иначе поле спорит с расчётом.
    setPrice(
      damage?.priceSource === 'manual' && damage.priceMinor ? String(damage.priceMinor / 100) : '',
    );
    setExtraWorks(
      (damage?.extraWorks ?? []).map((work) => ({
        priceListItemId: work.priceListItemId,
        title: work.title,
        quantity: work.quantity,
        unitPriceMinor: work.unitPriceMinor,
      })),
    );
    setPreview(null);
  }, [open, damage]);

  const widthMm = cmToMm(widthCm);
  const heightMm = cmToMm(heightCm);
  const sizeClass = sizeClassForDimensions(widthMm, heightMm);
  const size = describeDamageSize(widthMm, heightMm, sizeClass);
  const manualPriceMinor = price.trim() ? parseMajorToMinor(price) : null;

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
    // Цена детали — расчёт по прайсу с коэффициентом, если мастер не назвал свою.
    priceMinor: manualPriceMinor ?? preview?.pdrMinor ?? null,
    extraWorks,
  });

  // ── Расчёт стоимости ──────────────────────────────────────────────────────

  interface CalcParams {
    widthMm: number | null;
    heightMm: number | null;
    quantity: number;
    damageType: string;
    material: string;
    access: string;
    onEdge: boolean;
    extraWorks: DamageExtraWorkDraft[];
    manualPriceMinor: number | null;
  }

  const calc = useMutation({
    mutationFn: (input: CalcParams) =>
      api.post<AssessmentPreview>(`/workspaces/${workspaceId}/assessments/preview`, {
        items: [
          {
            panelCode,
            damageType: input.damageType || null,
            sizeClass: sizeClassForDimensions(input.widthMm, input.heightMm),
            widthMm: input.widthMm,
            heightMm: input.heightMm,
            quantity: input.quantity,
            material: input.material || null,
            accessDifficulty: input.access || null,
            onEdge: input.onEdge,
            unitPriceMinor: input.manualPriceMinor,
          },
        ],
        extras: input.extraWorks.map((work) => ({
          priceListItemId: work.priceListItemId,
          title: work.title,
          quantity: work.quantity,
          unitPriceMinor: work.unitPriceMinor,
        })),
      }),
    onSuccess: setPreview,
  });

  const params: CalcParams = useMemo(
    () => ({
      widthMm,
      heightMm,
      quantity,
      damageType,
      material,
      access,
      onEdge,
      extraWorks,
      manualPriceMinor,
    }),
    [
      widthMm,
      heightMm,
      quantity,
      damageType,
      material,
      access,
      onEdge,
      extraWorks,
      manualPriceMinor,
    ],
  );

  /**
   * Пересчёт после правки. Пауза нужна, чтобы ввод размера не отправлял запрос
   * на каждую цифру; значения берутся из подготовленного набора, а не из
   * состояния на момент отправки — иначе цена отставала бы на шаг.
   */
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!open) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => calc.mutate(params), 350);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // Мутация в зависимостях привела бы к вечному пересчёту: она новая на
    // каждый рендер, а ответ расчёта рендер и вызывает.
  }, [open, params]);

  const line = preview?.lines[0] ?? null;
  const priceMissing = line !== null && line.priceListItemId === null && manualPriceMinor === null;
  const extrasMinor = preview?.extrasMinor ?? 0;
  const pdrMinor = preview?.pdrMinor ?? 0;
  const totalMinor = preview?.totalMinor ?? 0;

  // ── Фотографии и сохранение ───────────────────────────────────────────────

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
          {/* Готовые зоны: мастер выбирает 40×40 одним нажатием. Точные габариты
              вводятся руками и остаются как есть — в карточке, в заказе и в
              документах показывается именно измеренное. */}
          <Field label="Размер зоны">
            <div className="pdr-chips">
              {SIZE_ZONE_CLASSES.map((zone) => (
                <button
                  key={zone.code}
                  type="button"
                  disabled={!canEdit}
                  className={`pdr-chip${
                    sizeClass === zone.code && !size.capped ? ' pdr-chip--active' : ''
                  }`}
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
          {size.actual ? (
            <div className="pdr-stack" style={{ gap: 2 }}>
              <div style={{ fontWeight: 600 }}>Размер: {size.actual}</div>
              <div className="pdr-hint">
                Тарифная зона: {size.zone}
                {size.capped ? ' — повреждение крупнее сетки, цена считается по верхней зоне' : ''}
              </div>
            </div>
          ) : (
            <div className="pdr-hint">Укажите размер — по нему подбирается цена.</div>
          )}
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

        {/* ── Арматурные работы этой детали ─────────────────────────────── */}
        <h2 className="pdr-subtitle">Арматурные работы</h2>
        <Card flat>
          <div className="pdr-list">
            {extraWorks.length === 0 ? (
              <div className="pdr-list__item pdr-list__item--static">
                <span className="pdr-hint">
                  Снятие обшивки, разбор двери, снятие фары — то, что нужно сделать на этой детали
                  помимо ремонта.
                </span>
              </div>
            ) : (
              extraWorks.map((work, index) => (
                <div key={index} className="pdr-list__item pdr-list__item--static">
                  <span className="pdr-grow">
                    <span style={{ display: 'block', fontWeight: 600 }}>{work.title}</span>
                    <Input
                      value={work.unitPriceMinor === null ? '' : String(work.unitPriceMinor / 100)}
                      inputMode="decimal"
                      disabled={!canEdit}
                      style={{ marginTop: 6 }}
                      placeholder={String(
                        (preview?.extras[index]?.suggestedUnitPriceMinor ?? 0) / 100,
                      )}
                      onChange={(e) => {
                        const value = e.target.value.trim()
                          ? (parseMajorToMinor(e.target.value) ?? 0)
                          : null;
                        setExtraWorks(
                          extraWorks.map((item, i) =>
                            i === index ? { ...item, unitPriceMinor: value } : item,
                          ),
                        );
                      }}
                    />
                  </span>
                  <span className="pdr-row" style={{ gap: 8, whiteSpace: 'nowrap' }}>
                    {preview?.extras[index] ? (
                      <span style={{ fontWeight: 600 }}>
                        {formatMinor(preview.extras[index]!.lineTotalMinor, currency)}
                      </span>
                    ) : null}
                    {canEdit ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setExtraWorks(extraWorks.filter((_, i) => i !== index))}
                      >
                        ✕
                      </Button>
                    ) : null}
                  </span>
                </div>
              ))
            )}
          </div>
        </Card>
        {canEdit ? (
          <Button variant="secondary" block onClick={() => setWorkPickerOpen(true)}>
            + Добавить работу
          </Button>
        ) : null}

        <Field label="Комментарий" hint="Что важно помнить. Работы выбираются выше, а не здесь">
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={2}
            disabled={!canEdit}
            placeholder="На что обратить внимание"
          />
        </Field>

        {/* ── Фотографии этой детали ────────────────────────────────────── */}
        {damage && !draftMode ? (
          <>
            <h2 className="pdr-subtitle">Фотографии детали</h2>
            {photos.length > 0 ? (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(104px, 1fr))',
                  gap: 8,
                }}
              >
                {photos.map((photo) => (
                  <div key={photo.id} className="pdr-stack" style={{ gap: 4 }}>
                    {photo.thumbUrl ? (
                      <img
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
                      <div className="pdr-skeleton" style={{ aspectRatio: '1' }} />
                    )}
                    {photo.hasMarkup ? <Badge tone="success">Зона отмечена</Badge> : null}
                    <Button size="sm" variant="secondary" onClick={() => setMarkupPhoto(photo)}>
                      {photo.hasMarkup ? 'Изменить зону' : 'Отметить зону ремонта'}
                    </Button>
                  </div>
                ))}
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
                hint="Снимок привяжется к этому повреждению. После загрузки отметьте на нём зону ремонта."
              />
            ) : null}
          </>
        ) : null}

        {/* ── Расчёт стоимости ──────────────────────────────────────────── */}
        <h2 className="pdr-subtitle">Расчёт стоимости</h2>
        <Card>
          {priceMissing ? (
            <>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>
                Цена для этих параметров не настроена
              </div>
              <div className="pdr-hint" style={{ marginBottom: 8 }}>
                В прайсе мастерской нет подходящей позиции. Укажите стоимость вручную — или заведите
                позицию в прайсе, чтобы она считалась сама.
              </div>
            </>
          ) : (
            <>
              <div className="pdr-row">
                <span className="pdr-grow pdr-hint">
                  PDR-ремонт{line?.priceListTitle ? ` · ${line.priceListTitle}` : ''}
                </span>
                <span>{formatMinor(preview?.baseMinor ?? 0, currency)}</span>
              </div>
              {preview && preview.priceCoefficient !== 100 ? (
                <>
                  <div className="pdr-formula" style={{ marginTop: 6 }}>
                    {preview.formula}
                  </div>
                  <div className="pdr-row" style={{ marginTop: 6 }}>
                    <span className="pdr-grow pdr-hint">
                      С коэффициентом {preview.priceCoefficient} %
                    </span>
                    <span>{formatMinor(pdrMinor, currency)}</span>
                  </div>
                </>
              ) : null}
            </>
          )}

          {extrasMinor > 0 ? (
            <div className="pdr-row">
              <span className="pdr-grow pdr-hint">Арматурные работы</span>
              <span>{formatMinor(extrasMinor, currency)}</span>
            </div>
          ) : null}

          <Field
            label="Своя цена ремонта"
            hint={
              priceMissing
                ? 'Сумма за ремонт этой детали, без арматурных работ'
                : 'Пусто — берётся расчёт по прайсу'
            }
          >
            <Input
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              inputMode="decimal"
              placeholder={String(Math.round((line?.suggestedUnitPriceMinor ?? 0) / 100))}
              disabled={!canEdit}
            />
          </Field>

          <div className="pdr-row" style={{ marginTop: 6 }}>
            <span className="pdr-grow" style={{ fontWeight: 600 }}>
              Итого по повреждению
            </span>
            <span style={{ fontSize: 18, fontWeight: 700 }}>
              {formatMinor(totalMinor, currency)}
            </span>
          </div>
          {calc.isPending ? <div className="pdr-hint">Считаем…</div> : null}
        </Card>

        {canEdit ? (
          <Button block loading={save.isPending} onClick={submit}>
            Готово
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
            Удалить повреждение
          </Button>
        ) : null}

        <Button variant="secondary" block onClick={onClose}>
          {canEdit ? 'Отмена' : 'Закрыть'}
        </Button>
      </div>

      <ExtraWorkPickerSheet
        open={workPickerOpen}
        onClose={() => setWorkPickerOpen(false)}
        workspaceId={workspaceId}
        currency={currency}
        onAdd={(choice) => {
          setExtraWorks((current) => [
            ...current,
            {
              priceListItemId: choice.priceListItemId,
              title: choice.title,
              quantity: 1,
              unitPriceMinor: choice.unitPriceMinor,
            },
          ]);
          setWorkPickerOpen(false);
        }}
      />

      <PhotoMarkupSheet
        open={markupPhoto !== null}
        onClose={() => setMarkupPhoto(null)}
        workspaceId={workspaceId}
        photo={markupPhoto}
        damages={damage ? [damage] : []}
        defaultDamageId={damage?.id ?? null}
        canEdit={canEdit}
      />
    </Sheet>
  );
}
