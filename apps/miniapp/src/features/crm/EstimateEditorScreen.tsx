import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@pdr/api-client';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  ListItem,
  Sheet,
  SkeletonList,
  Textarea,
} from '@pdr/ui';
import { api } from '@/shared/api';
import { formatMinor, parseMajorToMinor } from '@/shared/format';
import { alertDialog, confirmDialog, haptic } from '@/shared/telegram';
import { useDictionaries, useEstimate, usePriceList, useWorkspace } from './api';
import {
  ESTIMATE_STATUS_TONES,
  type DiscountKind,
  type EstimateItem,
  type EstimateItemKind,
} from './types';

/** Сантиметры на экране, миллиметры в базе. */
function cmToMm(value: string): number | null {
  const n = Number(value.replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 10);
}

interface ItemDraft {
  kind: EstimateItemKind;
  title: string;
  panelCode: string | null;
  damageType: string | null;
  sizeClass: string | null;
  /** Фактический размер повреждения в миллиметрах: он идёт в документы. */
  widthMm: number | null;
  heightMm: number | null;
  quantity: number;
  onEdge: boolean;
  material: 'steel' | 'aluminum' | 'other' | null;
  accessDifficulty: 'easy' | 'medium' | 'hard' | null;
  unitPriceMinor: number;
  priceListItemId: string | null;
  comment: string | null;
}

function toDraft(item: EstimateItem): ItemDraft {
  return {
    kind: item.kind,
    title: item.title,
    panelCode: item.panelCode,
    damageType: item.damageType,
    sizeClass: item.sizeClass,
    widthMm: item.widthMm,
    heightMm: item.heightMm,
    quantity: item.quantity,
    onEdge: item.onEdge,
    material: item.material,
    accessDifficulty: item.accessDifficulty,
    unitPriceMinor: item.unitPriceMinor,
    priceListItemId: item.priceListItemId,
    comment: item.comment,
  };
}

const EMPTY_DRAFT: ItemDraft = {
  kind: 'damage',
  title: '',
  panelCode: null,
  damageType: null,
  sizeClass: null,
  widthMm: null,
  heightMm: null,
  quantity: 1,
  onEdge: false,
  material: null,
  accessDifficulty: null,
  unitPriceMinor: 0,
  priceListItemId: null,
  comment: null,
};

/** Редактор сметы: позиции, скидка, отправка и согласование. */
export function EstimateEditorScreen() {
  const { workspaceId = '', estimateId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const estimate = useEstimate(workspaceId, estimateId);
  const workspace = useWorkspace(workspaceId);
  const priceList = usePriceList(workspaceId);
  const dictionaries = useDictionaries(workspaceId);

  const [itemSheet, setItemSheet] = useState(false);
  const [priceSheet, setPriceSheet] = useState(false);
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState<ItemDraft>(EMPTY_DRAFT);
  const [priceInput, setPriceInput] = useState('');
  const [discountValue, setDiscountValue] = useState('0');
  const [noteForClient, setNoteForClient] = useState('');

  useEffect(() => {
    if (!estimate.data) return;
    setDiscountValue(
      estimate.data.discountKind === 'fixed'
        ? String(estimate.data.discountValue / 100)
        : String(estimate.data.discountValue),
    );
    setNoteForClient(estimate.data.noteForClient ?? '');
  }, [estimate.data]);

  const invalidate = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['crm'] });
  };

  const saveItems = useMutation({
    mutationFn: (items: ItemDraft[]) =>
      api.put(`/workspaces/${workspaceId}/estimates/${estimateId}/items`, {
        items: items.map((item) => ({
          kind: item.kind,
          title: item.title || null,
          panelCode: item.panelCode,
          damageType: item.damageType,
          sizeClass: item.sizeClass,
          widthMm: item.widthMm,
          heightMm: item.heightMm,
          quantity: item.quantity,
          material: item.material,
          accessDifficulty: item.accessDifficulty,
          onEdge: item.onEdge,
          unitPriceMinor: item.unitPriceMinor,
          priceListItemId: item.priceListItemId,
          comment: item.comment,
        })),
      }),
    onSuccess: async () => {
      haptic('success');
      setItemSheet(false);
      setPriceSheet(false);
      setEditIndex(null);
      await invalidate();
    },
    onError: async (e) => {
      haptic('error');
      await alertDialog(e instanceof ApiError ? e.message : 'Не удалось сохранить позиции');
    },
  });

  const saveSettings = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.patch(`/workspaces/${workspaceId}/estimates/${estimateId}`, body),
    onSuccess: invalidate,
    onError: async (e) =>
      alertDialog(e instanceof ApiError ? e.message : 'Не удалось сохранить смету'),
  });

  const action = useMutation({
    mutationFn: (input: { path: string; body?: unknown }) =>
      api.post(`/workspaces/${workspaceId}/estimates/${estimateId}/${input.path}`, input.body),
    onSuccess: async () => {
      haptic('success');
      await invalidate();
    },
    onError: async (e) => {
      haptic('error');
      await alertDialog(e instanceof ApiError ? e.message : 'Не удалось выполнить действие');
    },
  });

  const openPdf = useMutation({
    mutationFn: async () => {
      const blob = await api.getBlob(`/workspaces/${workspaceId}/estimates/${estimateId}/pdf`);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      // Ссылку освобождаем позже: вкладка успевает открыться.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    },
    onError: async (e) =>
      alertDialog(e instanceof ApiError ? e.message : 'Не удалось открыть печатную форму'),
  });

  if (estimate.isLoading) return <SkeletonList rows={4} />;
  if (estimate.isError || !estimate.data) {
    return (
      <div className="pdr-stack">
        <EmptyState title="Смета недоступна" />
        <Button variant="secondary" block onClick={() => navigate(-1)}>
          Назад
        </Button>
      </div>
    );
  }

  const data = estimate.data;
  const currency = data.currency;
  const items = data.items.map(toDraft);
  const editable = data.status === 'draft' || data.status === 'sent';
  const canWrite =
    (workspace.data?.permissions.includes('estimates.write_own') ?? false) ||
    (workspace.data?.permissions.includes('estimates.write_all') ?? false);
  const canEdit = editable && canWrite;

  const applyItems = (next: ItemDraft[]): void => {
    saveItems.mutate(next);
  };

  const openNewItem = (): void => {
    setDraft(EMPTY_DRAFT);
    setPriceInput('');
    setEditIndex(null);
    setItemSheet(true);
  };

  const openEditItem = (index: number): void => {
    const item = items[index];
    if (!item) return;
    setDraft(item);
    setPriceInput(String(item.unitPriceMinor / 100));
    setEditIndex(index);
    setItemSheet(true);
  };

  const submitItem = (): void => {
    const minor = parseMajorToMinor(priceInput || '0');
    if (minor === null || minor < 0) {
      void alertDialog('Введите цену числом, например 1500 или 1500,50');
      return;
    }
    const prepared: ItemDraft = { ...draft, unitPriceMinor: minor };
    const next = [...items];
    if (editIndex === null) next.push(prepared);
    else next[editIndex] = prepared;
    applyItems(next);
  };

  const removeItem = async (index: number): Promise<void> => {
    if (!(await confirmDialog('Удалить позицию из сметы?'))) return;
    applyItems(items.filter((_, i) => i !== index));
  };

  const addFromPriceList = (priceItemId: string): void => {
    const source = priceList.data?.find((item) => item.id === priceItemId);
    if (!source) return;
    applyItems([
      ...items,
      {
        ...EMPTY_DRAFT,
        kind: source.kind,
        title: source.title,
        panelCode: source.panelCode,
        damageType: source.damageType,
        sizeClass: source.sizeClass,
        unitPriceMinor: source.unitPriceMinor,
        priceListItemId: source.id,
      },
    ]);
  };

  const applyDiscount = (kind: DiscountKind): void => {
    if (kind === 'none') {
      saveSettings.mutate({ discountKind: 'none', discountValue: 0 });
      return;
    }
    const raw = discountValue.trim() || '0';
    const value = kind === 'percent' ? Number(raw) : parseMajorToMinor(raw);
    if (value === null || Number.isNaN(value) || value < 0) {
      void alertDialog('Введите скидку числом');
      return;
    }
    saveSettings.mutate({ discountKind: kind, discountValue: Math.trunc(value) });
  };

  return (
    <div className="pdr-stack">
      <div className="pdr-row">
        <span className="pdr-grow">
          <h1 className="pdr-title" style={{ marginBottom: 0 }}>
            Смета, версия {data.versionNo}
          </h1>
          <span className="pdr-hint">
            {data.createdBy ? `составил ${data.createdBy}` : null}
            {data.agreedBy ? ` · согласовал ${data.agreedBy}` : ''}
          </span>
        </span>
        <Badge tone={ESTIMATE_STATUS_TONES[data.status]}>{data.statusLabel}</Badge>
      </div>

      {!editable ? (
        <Card>
          <div className="pdr-hint">
            Смета в этом статусе не редактируется. Чтобы изменить состав работ, создайте новую
            версию в карточке заказа.
          </div>
        </Card>
      ) : null}

      {items.length === 0 ? (
        <EmptyState title="Позиций нет" description="Добавьте работы из прайса или вручную." />
      ) : (
        <Card flat>
          <div className="pdr-list">
            {data.items.map((item, index) => (
              <ListItem
                key={item.id}
                title={`${item.title} · ${formatMinor(item.lineTotalMinor, currency)}`}
                subtitle={[
                  item.kindLabel,
                  `${item.quantity} × ${formatMinor(item.unitPriceMinor, currency)}`,
                  item.onEdge ? 'на ребре' : null,
                  item.comment,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                onClick={canEdit ? () => openEditItem(index) : undefined}
                right={
                  canEdit ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        void removeItem(index);
                      }}
                    >
                      ✕
                    </Button>
                  ) : null
                }
              />
            ))}
          </div>
        </Card>
      )}

      {canEdit ? (
        <div className="pdr-row">
          <Button variant="secondary" block onClick={() => setPriceSheet(true)}>
            Из прайса
          </Button>
          <Button variant="secondary" block onClick={openNewItem}>
            Вручную
          </Button>
        </div>
      ) : null}

      <Card>
        <div className="pdr-stack" style={{ gap: 6 }}>
          <div className="pdr-row">
            <span className="pdr-grow pdr-hint">Сумма работ</span>
            <span>{formatMinor(data.subtotalMinor, currency)}</span>
          </div>
          {data.discountMinor > 0 ? (
            <div className="pdr-row">
              <span className="pdr-grow pdr-hint">
                Скидка{data.discountKind === 'percent' ? ` ${data.discountValue}%` : ''}
              </span>
              <span>−{formatMinor(data.discountMinor, currency)}</span>
            </div>
          ) : null}
          <div className="pdr-row">
            <span className="pdr-grow" style={{ fontWeight: 600 }}>
              Итого
            </span>
            <span style={{ fontSize: 20, fontWeight: 700 }}>
              {formatMinor(data.totalMinor, currency)}
            </span>
          </div>
        </div>
      </Card>

      {canEdit ? (
        <Card>
          <div className="pdr-stack">
            <Field label="Скидка" hint="Проценты или сумма — как договорились с клиентом">
              <Input
                value={discountValue}
                inputMode="decimal"
                onChange={(e) => setDiscountValue(e.target.value)}
              />
            </Field>
            <div className="pdr-row">
              <Button size="sm" variant="secondary" onClick={() => applyDiscount('percent')}>
                Применить %
              </Button>
              <Button size="sm" variant="secondary" onClick={() => applyDiscount('fixed')}>
                Применить сумму
              </Button>
              <Button size="sm" variant="ghost" onClick={() => applyDiscount('none')}>
                Без скидки
              </Button>
            </div>

            <Field label="Комментарий для клиента">
              <Textarea
                rows={2}
                value={noteForClient}
                onChange={(e) => setNoteForClient(e.target.value)}
                onBlur={() => saveSettings.mutate({ noteForClient: noteForClient || null })}
              />
            </Field>
          </div>
        </Card>
      ) : data.noteForClient ? (
        <Card>
          <div className="pdr-hint">Комментарий для клиента</div>
          <div>{data.noteForClient}</div>
        </Card>
      ) : null}

      <Button
        variant="secondary"
        block
        loading={openPdf.isPending}
        onClick={() => openPdf.mutate()}
      >
        Печатная форма (PDF)
      </Button>

      {canWrite && data.status === 'draft' ? (
        <Button
          block
          disabled={items.length === 0 || action.isPending}
          onClick={() => action.mutate({ path: 'send' })}
        >
          Отправить клиенту
        </Button>
      ) : null}

      {canWrite && (data.status === 'draft' || data.status === 'sent') ? (
        <>
          <Button
            block
            disabled={items.length === 0 || action.isPending}
            onClick={async () => {
              if (
                await confirmDialog(
                  `Клиент согласовал смету на ${formatMinor(data.totalMinor, currency)}?`,
                )
              ) {
                action.mutate({ path: 'agree' });
              }
            }}
          >
            Согласовано клиентом
          </Button>
          <Button
            variant="danger"
            block
            disabled={action.isPending}
            onClick={async () => {
              if (await confirmDialog('Отметить смету отклонённой?')) {
                action.mutate({ path: 'reject', body: { reason: null } });
              }
            }}
          >
            Клиент отказался
          </Button>
        </>
      ) : null}

      <Button
        variant="secondary"
        block
        onClick={() => navigate(`/workspace/${workspaceId}/orders/${data.orderId}`)}
      >
        К заказу
      </Button>

      <Sheet open={priceSheet} onClose={() => setPriceSheet(false)} title="Позиция из прайса">
        {priceList.isLoading ? (
          <SkeletonList rows={3} />
        ) : (priceList.data?.length ?? 0) === 0 ? (
          <EmptyState
            title="Прайс пуст"
            description="Заполните прайс в разделе «Ещё», чтобы набирать смету в два тапа."
          />
        ) : (
          <div className="pdr-list">
            {priceList.data!.map((item) => (
              <ListItem
                key={item.id}
                title={item.title}
                subtitle={`${formatMinor(item.unitPriceMinor, currency)} ${item.unitLabel}`}
                onClick={() => addFromPriceList(item.id)}
              />
            ))}
          </div>
        )}
      </Sheet>

      <Sheet
        open={itemSheet}
        onClose={() => setItemSheet(false)}
        title={editIndex === null ? 'Новая позиция' : 'Позиция сметы'}
      >
        <div className="pdr-stack">
          <Field label="Что делаем">
            <div className="pdr-chips">
              {(
                [
                  ['damage', 'Повреждение'],
                  ['disassembly', 'Разборка'],
                  ['extra', 'Доп. работы'],
                ] as [EstimateItemKind, string][]
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={`pdr-chip${draft.kind === value ? ' pdr-chip--active' : ''}`}
                  onClick={() => setDraft({ ...draft, kind: value })}
                >
                  {label}
                </button>
              ))}
            </div>
          </Field>

          {draft.kind === 'damage' ? (
            <>
              <Field label="Элемент кузова">
                <select
                  className="pdr-select"
                  value={draft.panelCode ?? ''}
                  onChange={(e) => setDraft({ ...draft, panelCode: e.target.value || null })}
                >
                  <option value="">Не указан</option>
                  {(dictionaries.data?.panels ?? []).map((panel) => (
                    <option key={panel.code} value={panel.code}>
                      {panel.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Тип повреждения">
                <select
                  className="pdr-select"
                  value={draft.damageType ?? ''}
                  onChange={(e) => setDraft({ ...draft, damageType: e.target.value || null })}
                >
                  <option value="">Не указан</option>
                  {(dictionaries.data?.damageTypes ?? []).map((type) => (
                    <option key={type.code} value={type.code}>
                      {type.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Тарифная зона" hint="По ней подбирается цена в прайсе">
                <div className="pdr-chips">
                  {(dictionaries.data?.sizeClasses ?? []).map((size) => (
                    <button
                      key={size.code}
                      type="button"
                      className={`pdr-chip${draft.sizeClass === size.code ? ' pdr-chip--active' : ''}`}
                      onClick={() =>
                        setDraft({
                          ...draft,
                          sizeClass: draft.sizeClass === size.code ? null : size.code,
                        })
                      }
                    >
                      {size.label} · {size.hint}
                    </button>
                  ))}
                </div>
              </Field>
              {/* Фактический размер хранится отдельно от зоны: в смете и в
                  документах клиент должен видеть измеренное повреждение. */}
              <div className="pdr-row">
                <Field label="Ширина, см">
                  <Input
                    value={draft.widthMm === null ? '' : String(Math.round(draft.widthMm / 10))}
                    inputMode="decimal"
                    placeholder="40"
                    onChange={(e) => setDraft({ ...draft, widthMm: cmToMm(e.target.value) })}
                  />
                </Field>
                <Field label="Высота, см">
                  <Input
                    value={draft.heightMm === null ? '' : String(Math.round(draft.heightMm / 10))}
                    inputMode="decimal"
                    placeholder="40"
                    onChange={(e) => setDraft({ ...draft, heightMm: cmToMm(e.target.value) })}
                  />
                </Field>
              </div>
              <label className="pdr-row" style={{ cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={draft.onEdge}
                  onChange={(e) => setDraft({ ...draft, onEdge: e.target.checked })}
                />
                <span className="pdr-grow">На ребре или канте</span>
              </label>
              <Field label="Материал">
                <select
                  className="pdr-select"
                  value={draft.material ?? ''}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      material: (e.target.value || null) as ItemDraft['material'],
                    })
                  }
                >
                  <option value="">Не указан</option>
                  <option value="steel">Сталь</option>
                  <option value="aluminum">Алюминий</option>
                  <option value="other">Другое</option>
                </select>
              </Field>
              <Field label="Доступ">
                <select
                  className="pdr-select"
                  value={draft.accessDifficulty ?? ''}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      accessDifficulty: (e.target.value || null) as ItemDraft['accessDifficulty'],
                    })
                  }
                >
                  <option value="">Не указан</option>
                  <option value="easy">Простой</option>
                  <option value="medium">Средний</option>
                  <option value="hard">Сложный</option>
                </select>
              </Field>
            </>
          ) : null}

          <Field label="Название" hint="Если оставить пустым, соберём из справочников">
            <Input
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              placeholder="Капот — град, 12 шт, S"
            />
          </Field>

          <div className="pdr-row">
            <Field label="Количество">
              <Input
                type="number"
                min={1}
                value={draft.quantity}
                onChange={(e) =>
                  setDraft({ ...draft, quantity: Math.max(1, Number(e.target.value) || 1) })
                }
              />
            </Field>
            <Field label="Цена за единицу">
              <Input
                value={priceInput}
                inputMode="decimal"
                placeholder="1500"
                onChange={(e) => setPriceInput(e.target.value)}
              />
            </Field>
          </div>

          <Field label="Комментарий">
            <Input
              value={draft.comment ?? ''}
              onChange={(e) => setDraft({ ...draft, comment: e.target.value || null })}
            />
          </Field>

          <Button block loading={saveItems.isPending} onClick={submitItem}>
            Сохранить
          </Button>
          <Button variant="secondary" block onClick={() => setItemSheet(false)}>
            Отмена
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
