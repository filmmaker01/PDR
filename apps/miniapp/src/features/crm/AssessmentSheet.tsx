import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@pdr/api-client';
import { damageTypeLabel, panelLabel } from '@pdr/shared';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Sheet,
  SkeletonList,
  Textarea,
} from '@pdr/ui';
import { api } from '@/shared/api';
import { formatMinor, parseMajorToMinor } from '@/shared/format';
import { alertDialog, haptic } from '@/shared/telegram';
import { useAssessmentCapabilities, useDamages, useLeadPhotos, useOrderPhotos } from './api';
import type { DamageParent } from './DamageSheet';
import type {
  AssessmentAnalysis,
  AssessmentLine,
  AssessmentMethod,
  AssessmentPreview,
} from './types';

function basePath(workspaceId: string, parent: DamageParent): string {
  return 'leadId' in parent
    ? `/workspaces/${workspaceId}/leads/${parent.leadId}`
    : `/workspaces/${workspaceId}/orders/${parent.orderId}`;
}

interface LineDraft {
  damageId: string | null;
  panelCode: string;
  damageType: string | null;
  sizeClass: string | null;
  widthMm: number | null;
  heightMm: number | null;
  quantity: number;
  material: 'steel' | 'aluminum' | 'other' | null;
  accessDifficulty: 'easy' | 'medium' | 'hard' | null;
  onEdge: boolean;
  /**
   * Цена за единицу как её видит мастер, строкой. Именно строкой, а не числом:
   * иначе при стирании символа поле подставляло бы расчётную сумму и спорило
   * бы с тем, кто её правит. Пустая строка — «берём расчёт».
   */
  priceInput: string;
  comment: string | null;
}

/**
 * Оценка ремонта.
 *
 * Три способа, один результат: сохранённая оценка со строками и итогом,
 * который мастер всегда может переписать. Расчёт считает сервер по прайсу
 * мастерской — и для ручного ввода параметров, и для разбора фотографии,
 * поэтому «предварительная AI-оценка» не может разойтись с обычным расчётом.
 */
export function AssessmentSheet({
  open,
  onClose,
  workspaceId,
  parent,
  currency,
}: {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
  parent: DamageParent;
  currency: string;
}) {
  const queryClient = useQueryClient();
  const capabilities = useAssessmentCapabilities(workspaceId);
  const damages = useDamages(workspaceId, parent, open);

  const leadId = 'leadId' in parent ? parent.leadId : '';
  const orderId = 'orderId' in parent ? parent.orderId : '';
  const leadPhotos = useLeadPhotos(workspaceId, leadId, open && Boolean(leadId));
  const orderPhotos = useOrderPhotos(workspaceId, orderId);
  const photos = leadId ? (leadPhotos.data?.items ?? []) : (orderPhotos.data?.items ?? []);

  const [method, setMethod] = useState<AssessmentMethod>('params');
  const [manualTotal, setManualTotal] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [preview, setPreview] = useState<AssessmentPreview | null>(null);
  const [analysis, setAnalysis] = useState<AssessmentAnalysis | null>(null);
  const [selectedPhotos, setSelectedPhotos] = useState<string[]>([]);
  const [totalOverride, setTotalOverride] = useState('');

  const aiAvailable = capabilities.data?.methods.find((m) => m.value === 'ai')?.available ?? false;

  // Повреждения со схемы — готовый список позиций: их не нужно вводить заново.
  useEffect(() => {
    if (!open) return;
    setLines(
      (damages.data?.items ?? []).map((damage) => ({
        damageId: damage.id,
        panelCode: damage.panelCode,
        damageType: damage.damageType,
        sizeClass: damage.sizeClass,
        widthMm: damage.widthMm,
        heightMm: damage.heightMm,
        quantity: damage.quantity,
        material: damage.material,
        accessDifficulty: damage.accessDifficulty,
        onEdge: damage.onEdge,
        priceInput: '',
        comment: damage.comment,
      })),
    );
    setPreview(null);
    setAnalysis(null);
    setTotalOverride('');
    setSelectedPhotos([]);
  }, [open, damages.data]);

  const calc = useMutation({
    mutationFn: () =>
      api.post<AssessmentPreview>(`/workspaces/${workspaceId}/assessments/preview`, {
        items: lines.map(toItem),
      }),
    onSuccess: (result) => {
      setPreview(result);
      setAnalysis(null);
      // Расчёт заполняет поля цен, дальше мастер правит их как обычный ввод.
      setLines((current) =>
        current.map((line, index) => ({
          ...line,
          priceInput: String((result.lines[index]?.unitPriceMinor ?? 0) / 100),
        })),
      );
      setTotalOverride(String(result.totalMinor / 100));
    },
    onError: async (e) =>
      alertDialog(e instanceof ApiError ? e.message : 'Не удалось рассчитать стоимость'),
  });

  const analyze = useMutation({
    mutationFn: () =>
      api.post<AssessmentAnalysis>(`${basePath(workspaceId, parent)}/assessments/analyze`, {
        photoIds: selectedPhotos,
      }),
    onSuccess: (result) => {
      haptic('success');
      setAnalysis(result);
      setPreview(result);
      setTotalOverride(String(result.totalMinor / 100));
      // Разбор заполняет параметры, а не цену: дальше работает тот же расчёт.
      setLines(
        result.items.map((item, index) => ({
          damageId: null,
          panelCode: item.panelCode,
          damageType: item.damageType ?? null,
          sizeClass: item.sizeClass ?? null,
          widthMm: item.widthMm ?? null,
          heightMm: item.heightMm ?? null,
          quantity: item.quantity ?? 1,
          material: null,
          accessDifficulty: null,
          onEdge: false,
          priceInput: String((result.lines[index]?.unitPriceMinor ?? 0) / 100),
          comment: item.comment ?? null,
        })),
      );
    },
    onError: async (e) => {
      haptic('error');
      await alertDialog(e instanceof ApiError ? e.message : 'Не удалось разобрать фотографию');
    },
  });

  const save = useMutation({
    mutationFn: () => {
      const override = totalOverride.trim() ? parseMajorToMinor(totalOverride) : null;
      if (method === 'manual') {
        const total = parseMajorToMinor(manualTotal);
        if (total === null) throw new ApiError('validation_failed', 'Укажите стоимость', 422);
        return api.post(`${basePath(workspaceId, parent)}/assessments`, {
          method: 'manual',
          totalMinor: total,
          note: note.trim() || null,
        });
      }
      return api.post(`${basePath(workspaceId, parent)}/assessments`, {
        method,
        items: lines.map(toItem),
        totalMinor: override,
        note: note.trim() || null,
        ...(method === 'ai' && analysis
          ? {
              ai: {
                provider: analysis.ai.provider,
                model: analysis.ai.model,
                confidence: analysis.ai.confidence,
                explanation: analysis.ai.explanation,
                raw: analysis.ai.raw,
              },
            }
          : {}),
      });
    },
    onSuccess: async () => {
      haptic('success');
      await queryClient.invalidateQueries({ queryKey: ['crm'] });
      onClose();
    },
    onError: async (e) => {
      haptic('error');
      await alertDialog(e instanceof ApiError ? e.message : 'Не удалось сохранить оценку');
    },
  });

  const shownTotal = totalOverride.trim()
    ? (parseMajorToMinor(totalOverride) ?? preview?.totalMinor ?? 0)
    : (preview?.totalMinor ?? 0);

  // Пока расчёт не пересчитан на сервере, сумма строки считается из того, что
  // мастер видит в поле: иначе итог отставал бы от правки на один шаг.
  const linesTotal = preview
    ? lines.reduce((sum, line, index) => sum + lineTotal(line, preview.lines[index]), 0)
    : 0;

  return (
    <Sheet open={open} onClose={onClose} title="Сделать оценку">
      <div className="pdr-stack">
        <div className="pdr-chips">
          <MethodChip value="manual" method={method} onSelect={setMethod} label="Вручную" />
          <MethodChip value="params" method={method} onSelect={setMethod} label="По параметрам" />
          {aiAvailable ? (
            <MethodChip value="ai" method={method} onSelect={setMethod} label="По фотографии" />
          ) : null}
        </div>

        {!aiAvailable && capabilities.data ? (
          <div className="pdr-hint">
            Оценка по фотографии не подключена. Доступны ручная оценка и расчёт по прайсу.
          </div>
        ) : null}

        {method === 'manual' ? (
          <Card>
            <Field label="Стоимость" hint="Мастер называет сумму сам">
              <Input
                value={manualTotal}
                onChange={(e) => setManualTotal(e.target.value)}
                inputMode="decimal"
                placeholder="15000"
                autoFocus
              />
            </Field>
          </Card>
        ) : null}

        {method === 'ai' ? (
          <>
            <Card>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Фотографии для разбора</div>
              {photos.length === 0 ? (
                <div className="pdr-hint">
                  Сначала добавьте фотографии повреждения — разбирать пока нечего.
                </div>
              ) : (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(84px, 1fr))',
                    gap: 8,
                  }}
                >
                  {photos.map((photo) => {
                    const selected = selectedPhotos.includes(photo.id);
                    return (
                      <button
                        key={photo.id}
                        type="button"
                        style={{
                          all: 'unset',
                          position: 'relative',
                          cursor: 'pointer',
                          borderRadius: 8,
                          overflow: 'hidden',
                          outline: selected ? '3px solid var(--pdr-button)' : 'none',
                        }}
                        onClick={() =>
                          setSelectedPhotos((current) =>
                            current.includes(photo.id)
                              ? current.filter((id) => id !== photo.id)
                              : current.length >= 6
                                ? current
                                : [...current, photo.id],
                          )
                        }
                      >
                        {photo.thumbUrl ? (
                          <img
                            src={photo.thumbUrl}
                            alt=""
                            style={{ width: '100%', aspectRatio: '1', objectFit: 'cover' }}
                          />
                        ) : (
                          <div className="pdr-skeleton" style={{ aspectRatio: '1' }} />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
              <Button
                block
                style={{ marginTop: 10 }}
                disabled={selectedPhotos.length === 0}
                loading={analyze.isPending}
                onClick={() => analyze.mutate()}
              >
                Разобрать фотографии
              </Button>
            </Card>

            {analysis ? (
              <Card>
                <div className="pdr-row" style={{ marginBottom: 6 }}>
                  <span className="pdr-grow" style={{ fontWeight: 600 }}>
                    {analysis.label}
                  </span>
                  {analysis.ai.confidence !== null ? (
                    <Badge tone="muted">
                      уверенность {Math.round(analysis.ai.confidence * 100)}%
                    </Badge>
                  ) : null}
                </div>
                <div style={{ marginBottom: 6 }}>{analysis.ai.explanation}</div>
                <div className="pdr-hint">{analysis.disclaimer}</div>
              </Card>
            ) : null}
          </>
        ) : null}

        {method !== 'manual' ? (
          <>
            <h2 className="pdr-subtitle">Повреждения</h2>
            {damages.isLoading ? (
              <SkeletonList rows={2} />
            ) : lines.length === 0 ? (
              <EmptyState
                title="Нечего оценивать"
                description="Отметьте повреждения на схеме автомобиля или разберите фотографию."
              />
            ) : (
              <Card flat>
                <div className="pdr-list">
                  {lines.map((line, index) => {
                    const calculated = preview?.lines[index];
                    return (
                      <div key={index} className="pdr-list__item pdr-list__item--static">
                        <span className="pdr-grow">
                          <span style={{ display: 'block', fontWeight: 600 }}>
                            {panelLabel(line.panelCode)}
                          </span>
                          <span className="pdr-hint">
                            {[
                              damageTypeLabel(line.damageType),
                              line.sizeClass ? `размер ${line.sizeClass}` : null,
                              line.quantity > 1 ? `${line.quantity} шт` : null,
                              calculated?.priceListTitle,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                          {calculated ? (
                            <Input
                              value={line.priceInput}
                              inputMode="decimal"
                              style={{ marginTop: 6 }}
                              onChange={(e) =>
                                setLines((current) =>
                                  current.map((item, i) =>
                                    i === index ? { ...item, priceInput: e.target.value } : item,
                                  ),
                                )
                              }
                            />
                          ) : null}
                        </span>
                        {calculated ? (
                          <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                            {formatMinor(lineTotal(line, calculated), currency)}
                          </span>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </Card>
            )}

            <Button
              variant="secondary"
              block
              disabled={lines.length === 0}
              loading={calc.isPending}
              onClick={() => calc.mutate()}
            >
              Рассчитать по прайсу
            </Button>

            {preview ? (
              <Card>
                <div className="pdr-row">
                  <span className="pdr-grow pdr-hint">Расчёт по прайсу</span>
                  <span>{formatMinor(preview.suggestedMinor, currency)}</span>
                </div>
                {linesTotal !== preview.suggestedMinor ? (
                  <div className="pdr-row">
                    <span className="pdr-grow pdr-hint">С учётом ваших правок</span>
                    <span>{formatMinor(linesTotal, currency)}</span>
                  </div>
                ) : null}
                <Field label="Итог" hint="Можно переписать любую сумму вручную">
                  <Input
                    value={totalOverride}
                    inputMode="decimal"
                    onChange={(e) => setTotalOverride(e.target.value)}
                  />
                </Field>
                <div className="pdr-row" style={{ marginTop: 6 }}>
                  <span className="pdr-grow" style={{ fontWeight: 600 }}>
                    К оплате
                  </span>
                  <span style={{ fontSize: 18, fontWeight: 700 }}>
                    {formatMinor(shownTotal, currency)}
                  </span>
                </div>
              </Card>
            ) : null}
          </>
        ) : null}

        <Field label="Заметка к оценке">
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Что сказали клиенту"
          />
        </Field>

        <Button
          block
          loading={save.isPending}
          disabled={method === 'manual' ? !manualTotal.trim() : !preview}
          onClick={() => save.mutate()}
        >
          Сохранить оценку
        </Button>
        <Button variant="secondary" block onClick={onClose}>
          Отмена
        </Button>
      </div>
    </Sheet>
  );
}

function MethodChip({
  value,
  method,
  onSelect,
  label,
}: {
  value: AssessmentMethod;
  method: AssessmentMethod;
  onSelect: (value: AssessmentMethod) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      className={`pdr-chip${method === value ? ' pdr-chip--active' : ''}`}
      onClick={() => onSelect(value)}
    >
      {label}
    </button>
  );
}

/** Итог строки: введённая цена, если она разобралась, иначе расчётная. */
function lineTotal(line: LineDraft, calculated?: AssessmentLine): number {
  if (!calculated) return 0;
  const manual = line.priceInput.trim() ? parseMajorToMinor(line.priceInput) : null;
  return (manual ?? calculated.unitPriceMinor) * calculated.quantity;
}

function toItem(line: LineDraft) {
  return {
    damageId: line.damageId,
    panelCode: line.panelCode,
    damageType: line.damageType,
    sizeClass: line.sizeClass,
    widthMm: line.widthMm,
    heightMm: line.heightMm,
    quantity: line.quantity,
    material: line.material,
    accessDifficulty: line.accessDifficulty,
    onEdge: line.onEdge,
    unitPriceMinor: line.priceInput.trim() ? parseMajorToMinor(line.priceInput) : null,
    comment: line.comment,
  };
}

export type { AssessmentLine };
