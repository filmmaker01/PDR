import { useState } from 'react';
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
} from '@pdr/ui';
import { api } from '@/shared/api';
import { formatMinor, parseMajorToMinor } from '@/shared/format';
import { alertDialog, confirmDialog, haptic } from '@/shared/telegram';
import { useDictionaries, usePriceList, useWorkspace } from './api';
import type { EstimateItemKind, PriceListItem } from './types';

interface FormState {
  id: string | null;
  kind: EstimateItemKind;
  title: string;
  panelCode: string | null;
  damageType: string | null;
  sizeClass: string | null;
  price: string;
  unit: 'per_item' | 'per_dent' | 'per_hour';
}

const EMPTY: FormState = {
  id: null,
  kind: 'damage',
  title: '',
  panelCode: null,
  damageType: null,
  sizeClass: null,
  price: '',
  unit: 'per_item',
};

/** Прайс мастерской: справочник цен для быстрого набора сметы. */
export function PriceListScreen() {
  const { workspaceId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const workspace = useWorkspace(workspaceId);
  const [showInactive, setShowInactive] = useState(false);
  const priceList = usePriceList(workspaceId, showInactive);
  const dictionaries = useDictionaries(workspaceId);

  const [sheet, setSheet] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);

  const canManage = workspace.data?.permissions.includes('price_list.manage') ?? false;

  const invalidate = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['crm', 'price-list'] });
  };

  const save = useMutation({
    mutationFn: (state: FormState) => {
      const unitPriceMinor = parseMajorToMinor(state.price || '0');
      if (unitPriceMinor === null || unitPriceMinor < 0) {
        throw new ApiError('validation_failed', 'Введите цену числом', 422);
      }
      const body = {
        kind: state.kind,
        title: state.title.trim(),
        panelCode: state.panelCode,
        damageType: state.damageType,
        sizeClass: state.sizeClass,
        unitPriceMinor,
        unit: state.unit,
      };
      return state.id
        ? api.patch(`/workspaces/${workspaceId}/price-list/${state.id}`, body)
        : api.post(`/workspaces/${workspaceId}/price-list`, body);
    },
    onSuccess: async () => {
      haptic('success');
      setSheet(false);
      setForm(EMPTY);
      await invalidate();
    },
    onError: async (e) => {
      haptic('error');
      await alertDialog(e instanceof ApiError ? e.message : 'Не удалось сохранить позицию');
    },
  });

  const remove = useMutation({
    mutationFn: (itemId: string) =>
      api.delete<{ deleted: boolean }>(`/workspaces/${workspaceId}/price-list/${itemId}`),
    onSuccess: async (result) => {
      await invalidate();
      if (!result.deleted) {
        await alertDialog(
          'Позиция уже использована в сметах, поэтому она скрыта из прайса, а не удалена.',
        );
      }
    },
    onError: async (e) =>
      alertDialog(e instanceof ApiError ? e.message : 'Не удалось удалить позицию'),
  });

  const openEdit = (item: PriceListItem): void => {
    setForm({
      id: item.id,
      kind: item.kind,
      title: item.title,
      panelCode: item.panelCode,
      damageType: item.damageType,
      sizeClass: item.sizeClass,
      price: String(item.unitPriceMinor / 100),
      unit: item.unit,
    });
    setSheet(true);
  };

  const currency = workspace.data?.currency ?? 'RUB';

  return (
    <div className="pdr-stack">
      <h1 className="pdr-title">Прайс</h1>
      <div className="pdr-hint">
        Цены из прайса подставляются в смету одним тапом. Изменение прайса не меняет уже
        составленные сметы.
      </div>

      {canManage ? (
        <Button
          block
          onClick={() => {
            setForm(EMPTY);
            setSheet(true);
          }}
        >
          + Позиция прайса
        </Button>
      ) : null}

      {priceList.isLoading ? (
        <SkeletonList rows={4} />
      ) : (priceList.data?.length ?? 0) === 0 ? (
        <EmptyState
          title="Прайс пуст"
          description="Добавьте типовые работы: капот S, крыша M, снятие потолка."
        />
      ) : (
        <Card flat>
          <div className="pdr-list">
            {priceList.data!.map((item) => (
              <ListItem
                key={item.id}
                title={item.title}
                subtitle={`${formatMinor(item.unitPriceMinor, currency)} ${item.unitLabel}`}
                right={
                  <span className="pdr-row" style={{ gap: 6 }}>
                    {!item.isActive ? <Badge tone="muted">скрыта</Badge> : null}
                    {canManage ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (await confirmDialog(`Удалить «${item.title}» из прайса?`)) {
                            remove.mutate(item.id);
                          }
                        }}
                      >
                        ✕
                      </Button>
                    ) : null}
                  </span>
                }
                onClick={canManage ? () => openEdit(item) : undefined}
              />
            ))}
          </div>
        </Card>
      )}

      <Button variant="ghost" block onClick={() => setShowInactive(!showInactive)}>
        {showInactive ? 'Только активные' : 'Показать скрытые'}
      </Button>

      <Button
        variant="secondary"
        block
        onClick={() => navigate(`/workspace/${workspaceId}/settings`)}
      >
        Назад
      </Button>

      <Sheet
        open={sheet}
        onClose={() => setSheet(false)}
        title={form.id ? 'Позиция прайса' : 'Новая позиция'}
      >
        <div className="pdr-stack">
          <Field label="Название">
            <Input
              value={form.title}
              placeholder="Капот, град, S"
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </Field>

          <Field label="Цена">
            <Input
              value={form.price}
              inputMode="decimal"
              placeholder="1500"
              onChange={(e) => setForm({ ...form, price: e.target.value })}
            />
          </Field>

          <Field label="Считается">
            <div className="pdr-chips">
              {(
                [
                  ['per_item', 'за элемент'],
                  ['per_dent', 'за вмятину'],
                  ['per_hour', 'за час'],
                ] as [FormState['unit'], string][]
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={`pdr-chip${form.unit === value ? ' pdr-chip--active' : ''}`}
                  onClick={() => setForm({ ...form, unit: value })}
                >
                  {label}
                </button>
              ))}
            </div>
          </Field>

          <Field label="Элемент кузова">
            <select
              className="pdr-select"
              value={form.panelCode ?? ''}
              onChange={(e) => setForm({ ...form, panelCode: e.target.value || null })}
            >
              <option value="">Любой</option>
              {(dictionaries.data?.panels ?? []).map((panel) => (
                <option key={panel.code} value={panel.code}>
                  {panel.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Размер">
            <div className="pdr-chips">
              {(dictionaries.data?.sizeClasses ?? []).map((size) => (
                <button
                  key={size.code}
                  type="button"
                  className={`pdr-chip${form.sizeClass === size.code ? ' pdr-chip--active' : ''}`}
                  onClick={() =>
                    setForm({
                      ...form,
                      sizeClass: form.sizeClass === size.code ? null : size.code,
                    })
                  }
                >
                  {size.label}
                </button>
              ))}
            </div>
          </Field>

          <Button block loading={save.isPending} onClick={() => save.mutate(form)}>
            Сохранить
          </Button>
          <Button variant="secondary" block onClick={() => setSheet(false)}>
            Отмена
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
