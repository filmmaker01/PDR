import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@pdr/api-client';
import { DEFAULT_SIZE_TIER_RULE, SIZE_TIER_RULES, sizeTierLabel } from '@pdr/shared';
import { Badge, Button, Card, Field, Input, Sheet } from '@pdr/ui';
import { api } from '@/shared/api';
import { formatMinor, parseMajorToMinor } from '@/shared/format';
import { alertDialog, confirmDialog, haptic } from '@/shared/telegram';
import type { PriceListItem } from './types';

interface TierForm {
  id: string | null;
  widthCm: string;
  heightCm: string;
  /** Строка «крупнее остальных»: без верхней границы. */
  open: boolean;
  price: string;
  unit: 'per_item' | 'per_dent';
  isActive: boolean;
}

const EMPTY_TIER: TierForm = {
  id: null,
  widthCm: '',
  heightCm: '',
  open: false,
  price: '',
  unit: 'per_item',
  isActive: true,
};

/**
 * Пример структуры сетки, чтобы не набирать границы с нуля. Это не цены:
 * строки создаются с нулём, и мастер вписывает свои значения.
 */
const EXAMPLE_GRID_CM: readonly [number, number][] = [
  [10, 10],
  [20, 20],
  [30, 30],
  [40, 40],
  [40, 60],
  [60, 60],
  [60, 100],
  [100, 100],
];

function cmToMm(value: string): number | null {
  const n = Number(value.replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 10);
}

function mmToCm(mm: number | null): string {
  return mm === null ? '' : String(mm / 10).replace('.', ',');
}

function area(item: PriceListItem): number {
  return item.maxWidthMm && item.maxHeightMm
    ? item.maxWidthMm * item.maxHeightMm
    : Number.POSITIVE_INFINITY;
}

/**
 * Цены по размеру повреждения — главная таблица прайса.
 *
 * Мастер меряет вмятину рулеткой и вводит как есть, например 43 × 57 см.
 * Расчёт выбирает строку этой таблицы по правилу, которое написано прямо
 * здесь, — а сами строки, границы и цены мастерская правит сама, без нас.
 */
export function SizeTierGrid({
  workspaceId,
  items,
  canManage,
  currency,
}: {
  workspaceId: string;
  /** Все строки сетки, включая отключённые. */
  items: PriceListItem[];
  canManage: boolean;
  currency: string;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<TierForm | null>(null);

  const rows = [...items].sort((a, b) => area(a) - area(b) || a.position - b.position);
  const active = rows.filter((item) => item.isActive);

  const invalidate = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['crm', 'price-list'] });
  };

  const save = useMutation({
    mutationFn: (state: TierForm) => {
      const unitPriceMinor = parseMajorToMinor(state.price || '0');
      if (unitPriceMinor === null || unitPriceMinor < 0) {
        throw new ApiError('validation_failed', 'Введите цену числом', 422);
      }
      const maxWidthMm = state.open ? null : cmToMm(state.widthCm);
      const maxHeightMm = state.open ? null : cmToMm(state.heightCm);
      if (!state.open && (maxWidthMm === null || maxHeightMm === null)) {
        throw new ApiError(
          'validation_failed',
          'Укажите ширину и высоту диапазона в сантиметрах',
          422,
        );
      }
      const body = {
        maxWidthMm,
        maxHeightMm,
        unitPriceMinor,
        unit: state.unit,
        isActive: state.isActive,
      };
      return state.id
        ? api.patch(`/workspaces/${workspaceId}/price-list/${state.id}`, body)
        : api.post(`/workspaces/${workspaceId}/price-list`, {
            ...body,
            kind: 'damage',
            sizeTier: true,
          });
    },
    onSuccess: async () => {
      haptic('success');
      setForm(null);
      await invalidate();
    },
    onError: async (e) => {
      haptic('error');
      await alertDialog(e instanceof ApiError ? e.message : 'Не удалось сохранить диапазон');
    },
  });

  const remove = useMutation({
    mutationFn: (itemId: string) =>
      api.delete<{ deleted: boolean }>(`/workspaces/${workspaceId}/price-list/${itemId}`),
    onSuccess: async (result) => {
      setForm(null);
      await invalidate();
      if (!result.deleted) {
        await alertDialog('Диапазон уже использован в оценках, поэтому он отключён, а не удалён.');
      }
    },
    onError: async (e) =>
      alertDialog(e instanceof ApiError ? e.message : 'Не удалось удалить диапазон'),
  });

  const fillExample = useMutation({
    mutationFn: async () => {
      for (const [w, h] of EXAMPLE_GRID_CM) {
        await api.post(`/workspaces/${workspaceId}/price-list`, {
          kind: 'damage',
          sizeTier: true,
          maxWidthMm: w * 10,
          maxHeightMm: h * 10,
          unitPriceMinor: 0,
        });
      }
      await api.post(`/workspaces/${workspaceId}/price-list`, {
        kind: 'damage',
        sizeTier: true,
        maxWidthMm: null,
        maxHeightMm: null,
        unitPriceMinor: 0,
      });
    },
    onSuccess: async () => {
      haptic('success');
      await invalidate();
    },
    onError: async (e) => {
      await invalidate();
      await alertDialog(e instanceof ApiError ? e.message : 'Не удалось создать сетку');
    },
  });

  const openEdit = (item: PriceListItem): void => {
    setForm({
      id: item.id,
      widthCm: mmToCm(item.maxWidthMm),
      heightCm: mmToCm(item.maxHeightMm),
      open: item.maxWidthMm === null,
      price: String(item.unitPriceMinor / 100),
      unit: item.unit === 'per_dent' ? 'per_dent' : 'per_item',
      isActive: item.isActive,
    });
  };

  const label = (item: PriceListItem): string => {
    const text = sizeTierLabel(item, active.length > 0 ? active : rows);
    return item.maxWidthMm === null ? text : `до ${text}`;
  };

  return (
    <Card>
      <div className="pdr-stack">
        <div style={{ fontWeight: 700 }}>Цены по размеру</div>
        <div className="pdr-hint">
          Мастер вводит фактический размер по рулетке, например 43 × 57 см. Он сохраняется как есть,
          а цена берётся из строки этой таблицы.
        </div>
        <div className="pdr-formula">
          Правило: {SIZE_TIER_RULES[DEFAULT_SIZE_TIER_RULE].description} Например, 43 × 57 см не
          помещается в 40 × 60 (43 больше 40) и считается по следующему диапазону, который его
          покрывает.
        </div>

        {rows.length === 0 ? (
          <div className="pdr-hint">
            Таблица пуста — расчёт берёт цены из позиций ниже. Добавьте диапазоны вручную или
            создайте примерную сетку и впишите свои цены.
          </div>
        ) : (
          <div className="pdr-list">
            {rows.map((item) => (
              <button
                key={item.id}
                type="button"
                className="pdr-row"
                style={{
                  all: 'unset',
                  display: 'flex',
                  gap: 8,
                  alignItems: 'center',
                  padding: '10px 0',
                  borderBottom: '1px solid var(--pdr-border, rgba(0,0,0,0.08))',
                  cursor: canManage ? 'pointer' : 'default',
                  opacity: item.isActive ? 1 : 0.55,
                }}
                onClick={canManage ? () => openEdit(item) : undefined}
              >
                <span className="pdr-grow" style={{ fontWeight: 600 }}>
                  {label(item)} {item.maxWidthMm === null ? '' : 'см'}
                </span>
                {!item.isActive ? <Badge tone="muted">отключён</Badge> : null}
                {item.unitPriceMinor === 0 ? <Badge tone="warning">нет цены</Badge> : null}
                <span>
                  {formatMinor(item.unitPriceMinor, currency)}
                  {item.unit === 'per_dent' ? ' / вмятина' : ''}
                </span>
              </button>
            ))}
          </div>
        )}

        {canManage ? (
          <Button block variant="secondary" onClick={() => setForm({ ...EMPTY_TIER })}>
            + Диапазон
          </Button>
        ) : null}
        {canManage && rows.length === 0 ? (
          <Button
            block
            variant="ghost"
            loading={fillExample.isPending}
            onClick={() => fillExample.mutate()}
          >
            Создать примерную сетку (10×10 … 100×100+)
          </Button>
        ) : null}
      </div>

      <Sheet
        open={form !== null}
        onClose={() => setForm(null)}
        title={form?.id ? 'Диапазон размера' : 'Новый диапазон'}
      >
        {form ? (
          <div className="pdr-stack">
            <label className="pdr-row" style={{ cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={form.open}
                onChange={(e) => setForm({ ...form, open: e.target.checked })}
              />
              <span className="pdr-grow">
                Крупнее всех остальных
                <span className="pdr-hint" style={{ display: 'block' }}>
                  Без верхней границы — например, «100×100+».
                </span>
              </span>
            </label>

            {form.open ? null : (
              <div className="pdr-row">
                <Field label="Ширина до, см">
                  <Input
                    value={form.widthCm}
                    inputMode="decimal"
                    placeholder="40"
                    onChange={(e) => setForm({ ...form, widthCm: e.target.value })}
                  />
                </Field>
                <Field label="Высота до, см">
                  <Input
                    value={form.heightCm}
                    inputMode="decimal"
                    placeholder="60"
                    onChange={(e) => setForm({ ...form, heightCm: e.target.value })}
                  />
                </Field>
              </div>
            )}

            <Field label="Базовая цена">
              <Input
                value={form.price}
                inputMode="decimal"
                placeholder="5000"
                onChange={(e) => setForm({ ...form, price: e.target.value })}
              />
            </Field>

            <Field label="Считается">
              <div className="pdr-chips">
                {(
                  [
                    ['per_item', 'за повреждение'],
                    ['per_dent', 'за вмятину'],
                  ] as [TierForm['unit'], string][]
                ).map(([value, text]) => (
                  <button
                    key={value}
                    type="button"
                    className={`pdr-chip${form.unit === value ? ' pdr-chip--active' : ''}`}
                    onClick={() => setForm({ ...form, unit: value })}
                  >
                    {text}
                  </button>
                ))}
              </div>
            </Field>

            <label className="pdr-row" style={{ cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
              />
              <span className="pdr-grow">
                Диапазон включён
                <span className="pdr-hint" style={{ display: 'block' }}>
                  Отключённый диапазон не участвует в расчёте. Уже составленные оценки и сметы не
                  меняются.
                </span>
              </span>
            </label>

            <Button block loading={save.isPending} onClick={() => save.mutate(form)}>
              Сохранить
            </Button>
            {form.id ? (
              <Button
                block
                variant="danger"
                loading={remove.isPending}
                onClick={async () => {
                  if (await confirmDialog('Удалить диапазон из таблицы?')) remove.mutate(form.id!);
                }}
              >
                Удалить диапазон
              </Button>
            ) : null}
            <Button block variant="secondary" onClick={() => setForm(null)}>
              Отмена
            </Button>
          </div>
        ) : null}
      </Sheet>
    </Card>
  );
}
