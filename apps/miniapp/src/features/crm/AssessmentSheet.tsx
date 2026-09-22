import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@pdr/api-client';
import { damageTypeLabel, panelLabel, sizeClassLabel } from '@pdr/shared';
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
import {
  useAssessmentCapabilities,
  useDamages,
  useLeadPhotos,
  useOrderPhotos,
  usePriceList,
} from './api';
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
   * Цена за единицу как её видит мастер, строкой. Пустая строка — «берём
   * расчёт»: подставлять туда расчётную сумму нельзя, иначе поле спорит
   * с тем, кто его правит, и в итоге сохраняется устаревшее число.
   */
  priceInput: string;
  comment: string | null;
}

/** Арматурная работа в наборе: позиция справочника или своя. */
interface ExtraDraft {
  priceListItemId: string | null;
  title: string;
  damageId: string | null;
  /** Пустая строка — цена из справочника. */
  priceInput: string;
}

/**
 * Оценка ремонта.
 *
 * Три способа, один результат. Считает всегда сервер по прайсу мастерской:
 * базовый расчёт, затем коэффициент цены, затем ручная правка. Ни одна сумма
 * на этом экране не считается в интерфейсе — иначе показанное и сохранённое
 * снова начали бы расходиться.
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
  const priceList = usePriceList(workspaceId);

  const leadId = 'leadId' in parent ? parent.leadId : '';
  const orderId = 'orderId' in parent ? parent.orderId : '';
  const leadPhotos = useLeadPhotos(workspaceId, leadId, open && Boolean(leadId));
  const orderPhotos = useOrderPhotos(workspaceId, orderId);
  const photos = leadId ? (leadPhotos.data?.items ?? []) : (orderPhotos.data?.items ?? []);

  const [method, setMethod] = useState<AssessmentMethod>('params');
  const [manualTotal, setManualTotal] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [extras, setExtras] = useState<ExtraDraft[]>([]);
  const [coefficient, setCoefficient] = useState<number | null>(null);
  const [preview, setPreview] = useState<AssessmentPreview | null>(null);
  const [analysis, setAnalysis] = useState<AssessmentAnalysis | null>(null);
  const [selectedPhotos, setSelectedPhotos] = useState<string[]>([]);
  const [finalPrice, setFinalPrice] = useState('');
  const [addWorkOpen, setAddWorkOpen] = useState(false);

  const aiAvailable = capabilities.data?.methods.find((m) => m.value === 'ai')?.available ?? false;
  const bounds = capabilities.data?.priceCoefficient ?? { min: 50, max: 200, step: 5 };
  /** Справочник арматурных работ — те же позиции прайса, но не для повреждений. */
  const workCatalog = useMemo(
    () => (priceList.data ?? []).filter((item) => item.kind !== 'damage'),
    [priceList.data],
  );

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
    setExtras([]);
    setCoefficient(null);
    setPreview(null);
    setAnalysis(null);
    setFinalPrice('');
    setSelectedPhotos([]);
  }, [open, damages.data]);

  interface CalcInput {
    lines: LineDraft[];
    extras: ExtraDraft[];
    coefficient: number | null;
  }

  const calc = useMutation({
    mutationFn: (input: CalcInput) =>
      api.post<AssessmentPreview>(`/workspaces/${workspaceId}/assessments/preview`, {
        items: input.lines.map(toItem),
        extras: input.extras.map(toExtra),
        ...(input.coefficient !== null ? { priceCoefficient: input.coefficient } : {}),
      }),
    onSuccess: (result) => {
      setPreview(result);
      setAnalysis(null);
      // Коэффициент приходит с сервера: по умолчанию — привычка мастерской.
      setCoefficient(result.priceCoefficient);
    },
    onError: async (e) =>
      alertDialog(e instanceof ApiError ? e.message : 'Не удалось рассчитать стоимость'),
  });

  /**
   * Пересчёт на сервере после правки.
   *
   * Расчёт отправляется с новыми значениями, а не читается из состояния:
   * состояние на момент обработчика ещё старое, и итог отставал бы на шаг.
   * Пауза нужна ползунку — иначе запрос уходил бы на каждый шаг 5 %.
   */
  const calcTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestCalc = (next: CalcInput, immediate = false): void => {
    if (calcTimer.current) clearTimeout(calcTimer.current);
    if (immediate) {
      calc.mutate(next);
      return;
    }
    calcTimer.current = setTimeout(() => calc.mutate(next), 300);
  };

  useEffect(
    () => () => {
      if (calcTimer.current) clearTimeout(calcTimer.current);
    },
    [],
  );

  const analyze = useMutation({
    mutationFn: () =>
      api.post<AssessmentAnalysis>(`${basePath(workspaceId, parent)}/assessments/analyze`, {
        photoIds: selectedPhotos,
      }),
    onSuccess: (result) => {
      haptic('success');
      setAnalysis(result);
      setPreview(result);
      setCoefficient(result.priceCoefficient);
      // Разбор заполняет параметры, а не цену: дальше работает тот же расчёт.
      setLines(
        result.items.map((item) => ({
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
          priceInput: '',
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
      if (method === 'manual') {
        const total = parseMajorToMinor(manualTotal);
        if (total === null) throw new ApiError('validation_failed', 'Укажите стоимость', 422);
        return api.post(`${basePath(workspaceId, parent)}/assessments`, {
          method: 'manual',
          totalMinor: total,
          note: note.trim() || null,
        });
      }
      const override = finalPrice.trim() ? parseMajorToMinor(finalPrice) : null;
      if (finalPrice.trim() && override === null) {
        throw new ApiError('validation_failed', 'Окончательная цена — число', 422);
      }
      return api.post(`${basePath(workspaceId, parent)}/assessments`, {
        method,
        items: lines.map(toItem),
        extras: extras.map(toExtra),
        ...(coefficient !== null ? { priceCoefficient: coefficient } : {}),
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

  const manualFinal = finalPrice.trim() ? parseMajorToMinor(finalPrice) : null;
  const shownTotal = manualFinal ?? preview?.totalMinor ?? 0;
  const percentLabel = (value: number): string =>
    value === 100 ? 'без изменений' : `${value > 100 ? '+' : '−'}${Math.abs(value - 100)} %`;

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
                              line.sizeClass ? `размер ${sizeClassLabel(line.sizeClass)}` : null,
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
                              placeholder={String(calculated.suggestedUnitPriceMinor / 100)}
                              onChange={(e) => {
                                const next = lines.map((item, i) =>
                                  i === index ? { ...item, priceInput: e.target.value } : item,
                                );
                                setLines(next);
                                requestCalc({ lines: next, extras, coefficient });
                              }}
                            />
                          ) : null}
                        </span>
                        {calculated ? (
                          <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                            {formatMinor(calculated.lineTotalMinor, currency)}
                          </span>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </Card>
            )}

            <h2 className="pdr-subtitle">Арматурные работы</h2>
            <Card flat>
              <div className="pdr-list">
                {extras.length === 0 ? (
                  <div className="pdr-list__item pdr-list__item--static">
                    <span className="pdr-hint">
                      Снятие обшивки, разбор двери, снятие фары — добавляются к повреждению и
                      суммируются с ремонтом.
                    </span>
                  </div>
                ) : (
                  extras.map((extra, index) => {
                    const calculated = preview?.extras[index];
                    return (
                      <div key={index} className="pdr-list__item pdr-list__item--static">
                        <span className="pdr-grow">
                          <span style={{ display: 'block', fontWeight: 600 }}>{extra.title}</span>
                          {extra.damageId ? (
                            <span className="pdr-hint">
                              {panelLabel(
                                lines.find((line) => line.damageId === extra.damageId)?.panelCode,
                              ) ?? 'деталь'}
                            </span>
                          ) : null}
                          <Input
                            value={extra.priceInput}
                            inputMode="decimal"
                            style={{ marginTop: 6 }}
                            placeholder={String(
                              (calculated?.suggestedUnitPriceMinor ?? 0) / 100 || 0,
                            )}
                            onChange={(e) => {
                              const next = extras.map((item, i) =>
                                i === index ? { ...item, priceInput: e.target.value } : item,
                              );
                              setExtras(next);
                              requestCalc({ lines, extras: next, coefficient });
                            }}
                          />
                        </span>
                        <span className="pdr-row" style={{ gap: 8, whiteSpace: 'nowrap' }}>
                          {calculated ? (
                            <span style={{ fontWeight: 600 }}>
                              {formatMinor(calculated.lineTotalMinor, currency)}
                            </span>
                          ) : null}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              const next = extras.filter((_, i) => i !== index);
                              setExtras(next);
                              requestCalc({ lines, extras: next, coefficient }, true);
                            }}
                          >
                            ✕
                          </Button>
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            </Card>
            <Button variant="secondary" block onClick={() => setAddWorkOpen(true)}>
              + Арматурная работа
            </Button>

            <Button
              block
              disabled={lines.length === 0 && extras.length === 0}
              loading={calc.isPending && !preview}
              onClick={() => requestCalc({ lines, extras, coefficient }, true)}
            >
              Рассчитать по прайсу
            </Button>

            {preview ? (
              <Card>
                <Field
                  label={`Коэффициент цены: ${preview.priceCoefficient} % · ${percentLabel(preview.priceCoefficient)}`}
                  hint="Поправка под регион и рынок. Размер, материал, доступ и ребро уже учтены в базовом расчёте."
                >
                  <input
                    type="range"
                    className="pdr-range"
                    min={bounds.min}
                    max={bounds.max}
                    step={bounds.step}
                    value={coefficient ?? preview.priceCoefficient}
                    onChange={(e) => {
                      const value = Number(e.target.value);
                      setCoefficient(value);
                      requestCalc({ lines, extras, coefficient: value });
                    }}
                  />
                </Field>
                <div className="pdr-row" style={{ gap: 6, marginTop: 4 }}>
                  {[bounds.min, 100, bounds.max].map((value) => (
                    <button
                      key={value}
                      type="button"
                      className={`pdr-chip${(coefficient ?? preview.priceCoefficient) === value ? ' pdr-chip--active' : ''}`}
                      onClick={() => {
                        setCoefficient(value);
                        requestCalc({ lines, extras, coefficient: value }, true);
                      }}
                    >
                      {value} %
                    </button>
                  ))}
                </div>

                <div className="pdr-formula" style={{ marginTop: 10 }}>
                  {preview.formula}
                </div>

                <div className="pdr-row" style={{ marginTop: 8 }}>
                  <span className="pdr-grow pdr-hint">Базовый расчёт по прайсу</span>
                  <span>{formatMinor(preview.baseMinor, currency)}</span>
                </div>
                {preview.priceCoefficient !== 100 ? (
                  <div className="pdr-row">
                    <span className="pdr-grow pdr-hint">
                      После коэффициента {preview.priceCoefficient} %
                    </span>
                    <span>{formatMinor(preview.pdrMinor, currency)}</span>
                  </div>
                ) : null}
                {preview.extrasMinor > 0 ? (
                  <div className="pdr-row">
                    <span className="pdr-grow pdr-hint">Арматурные работы</span>
                    <span>{formatMinor(preview.extrasMinor, currency)}</span>
                  </div>
                ) : null}
                <div className="pdr-row">
                  <span className="pdr-grow pdr-hint">Итог расчёта</span>
                  <span>{formatMinor(preview.totalMinor, currency)}</span>
                </div>

                <Field
                  label="Окончательная цена"
                  hint="Пусто — берётся итог расчёта. Любую сумму можно назначить вручную."
                >
                  <Input
                    value={finalPrice}
                    inputMode="decimal"
                    placeholder={String(preview.totalMinor / 100)}
                    onChange={(e) => setFinalPrice(e.target.value)}
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

      <AddWorkSheet
        open={addWorkOpen}
        onClose={() => setAddWorkOpen(false)}
        catalog={workCatalog}
        lines={lines}
        currency={currency}
        onAdd={(draft) => {
          const next = [...extras, draft];
          setExtras(next);
          setAddWorkOpen(false);
          requestCalc({ lines, extras: next, coefficient }, true);
        }}
      />
    </Sheet>
  );
}

/**
 * Выбор арматурной работы.
 *
 * Справочник мастерской редактируемый, поэтому список приходит из прайса, а не
 * из кода. Своя работа добавляется здесь же — на осмотре некогда идти в
 * настройки, чтобы завести позицию.
 */
function AddWorkSheet({
  open,
  onClose,
  catalog,
  lines,
  currency,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  catalog: { id: string; title: string; unitPriceMinor: number }[];
  lines: LineDraft[];
  currency: string;
  onAdd: (draft: ExtraDraft) => void;
}) {
  const [damageId, setDamageId] = useState<string | null>(null);
  const [ownTitle, setOwnTitle] = useState('');
  const [ownPrice, setOwnPrice] = useState('');

  useEffect(() => {
    if (!open) return;
    setDamageId(null);
    setOwnTitle('');
    setOwnPrice('');
  }, [open]);

  const damageOptions = lines.filter((line) => line.damageId);

  return (
    <Sheet open={open} onClose={onClose} title="Арматурные работы">
      <div className="pdr-stack">
        {damageOptions.length > 0 ? (
          <Field label="К какой детали" hint="Нужно для итога по детали в документах">
            <select
              className="pdr-select"
              value={damageId ?? ''}
              onChange={(e) => setDamageId(e.target.value || null)}
            >
              <option value="">Ко всей машине</option>
              {damageOptions.map((line) => (
                <option key={line.damageId!} value={line.damageId!}>
                  {panelLabel(line.panelCode)}
                </option>
              ))}
            </select>
          </Field>
        ) : null}

        {catalog.length === 0 ? (
          <EmptyState
            title="Справочник пуст"
            description="Добавьте арматурные работы в прайсе мастерской или назовите работу здесь."
          />
        ) : (
          <Card flat>
            <div className="pdr-list">
              {catalog.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="pdr-list__item pdr-list__item--button"
                  onClick={() =>
                    onAdd({
                      priceListItemId: item.id,
                      title: item.title,
                      damageId,
                      priceInput: '',
                    })
                  }
                >
                  <span className="pdr-grow">{item.title}</span>
                  <span style={{ whiteSpace: 'nowrap' }}>
                    {formatMinor(item.unitPriceMinor, currency)}
                  </span>
                </button>
              ))}
            </div>
          </Card>
        )}

        <h2 className="pdr-subtitle">Своя работа</h2>
        <Card>
          <Field label="Название">
            <Input
              value={ownTitle}
              onChange={(e) => setOwnTitle(e.target.value)}
              placeholder="Снятие подкрылка"
            />
          </Field>
          <Field label="Цена">
            <Input
              value={ownPrice}
              inputMode="decimal"
              placeholder="1500"
              onChange={(e) => setOwnPrice(e.target.value)}
            />
          </Field>
          <Button
            block
            disabled={!ownTitle.trim()}
            onClick={() =>
              onAdd({
                priceListItemId: null,
                title: ownTitle.trim(),
                damageId,
                priceInput: ownPrice.trim() || '0',
              })
            }
          >
            Добавить работу
          </Button>
          <div className="pdr-hint" style={{ marginTop: 6 }}>
            Разовая работа только для этой оценки. Чтобы она появилась в справочнике, добавьте её в
            прайсе.
          </div>
        </Card>

        <Button variant="secondary" block onClick={onClose}>
          Закрыть
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

function toExtra(extra: ExtraDraft) {
  return {
    priceListItemId: extra.priceListItemId,
    damageId: extra.damageId,
    title: extra.title,
    unitPriceMinor: extra.priceInput.trim() ? parseMajorToMinor(extra.priceInput) : null,
  };
}

export type { AssessmentLine };
