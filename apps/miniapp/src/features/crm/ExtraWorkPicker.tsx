import { useEffect, useMemo, useState } from 'react';
import { panelLabel } from '@pdr/shared';
import { Button, Card, EmptyState, Field, Input, Sheet, SkeletonList } from '@pdr/ui';
import { formatMinor, parseMajorToMinor } from '@/shared/format';
import { usePriceList } from './api';

/** Что выбрал мастер: позиция справочника или своя разовая работа. */
export interface ExtraWorkChoice {
  priceListItemId: string | null;
  title: string;
  /** Цена, введённая вручную. null — берётся из справочника. */
  unitPriceMinor: number | null;
  /** Деталь, к которой относится работа. Пусто — ко всей машине. */
  damageId: string | null;
}

export interface ExtraWorkDamageOption {
  id: string;
  panelCode: string;
}

/**
 * Выбор арматурной работы: снятие обшивки, разбор двери, снятие фары.
 *
 * Справочник мастерской редактируемый, поэтому список приходит из прайса,
 * а не из кода. Своя работа добавляется здесь же — на осмотре некогда идти
 * в настройки, чтобы завести позицию.
 *
 * Один экран на два места: карточку повреждения и оценку. Разница только
 * в том, известна ли деталь заранее.
 */
export function ExtraWorkPickerSheet({
  open,
  onClose,
  workspaceId,
  currency,
  damageOptions,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
  currency: string;
  /** Выбор детали. Не передан — работа уже относится к открытому повреждению. */
  damageOptions?: ExtraWorkDamageOption[];
  onAdd: (choice: ExtraWorkChoice) => void;
}) {
  const priceList = usePriceList(workspaceId);
  const [damageId, setDamageId] = useState<string | null>(null);
  const [ownTitle, setOwnTitle] = useState('');
  const [ownPrice, setOwnPrice] = useState('');

  const catalog = useMemo(
    () => (priceList.data ?? []).filter((item) => item.kind !== 'damage'),
    [priceList.data],
  );

  useEffect(() => {
    if (!open) return;
    setDamageId(null);
    setOwnTitle('');
    setOwnPrice('');
  }, [open]);

  return (
    <Sheet open={open} onClose={onClose} title="Арматурные работы">
      <div className="pdr-stack">
        {damageOptions && damageOptions.length > 0 ? (
          <Field label="К какой детали" hint="Нужно для итога по детали в документах">
            <select
              className="pdr-select"
              value={damageId ?? ''}
              onChange={(e) => setDamageId(e.target.value || null)}
            >
              <option value="">Ко всей машине</option>
              {damageOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {panelLabel(option.panelCode)}
                </option>
              ))}
            </select>
          </Field>
        ) : null}

        {priceList.isLoading ? (
          <SkeletonList rows={3} />
        ) : catalog.length === 0 ? (
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
                      unitPriceMinor: null,
                      damageId,
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
                unitPriceMinor: ownPrice.trim() ? (parseMajorToMinor(ownPrice) ?? 0) : 0,
                damageId,
              })
            }
          >
            Добавить работу
          </Button>
          <div className="pdr-hint" style={{ marginTop: 6 }}>
            Разовая работа только для этого заказа. Чтобы она появилась в справочнике, добавьте её в
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
