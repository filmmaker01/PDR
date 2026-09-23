import { useMemo, useRef, useState } from 'react';
import { CarScheme, Card, EmptyState, SkeletonList } from '@pdr/ui';
import { damageTypeLabel, panelLabel } from '@pdr/shared';
import { Button } from '@pdr/ui';
import { formatMinor } from '@/shared/format';
import { useDamages } from './api';
import { DamageSheet, type DamageParent } from './DamageSheet';
import type { Damage } from './types';

/**
 * Схема автомобиля и список отмеченных повреждений.
 *
 * Один и тот же блок показывается в обращении и в заказе: после конверсии
 * повреждения переезжают вместе с карточкой, и мастер видит ровно то же,
 * что отмечал при первом осмотре.
 */
export function DamagesTab({
  workspaceId,
  parent,
  canEdit,
  currency,
}: {
  workspaceId: string;
  parent: DamageParent;
  canEdit: boolean;
  currency: string;
}) {
  const damages = useDamages(workspaceId, parent);
  const [panelCode, setPanelCode] = useState<string | null>(null);
  const [editing, setEditing] = useState<Damage | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [hintScheme, setHintScheme] = useState(false);
  const schemeRef = useRef<HTMLDivElement>(null);

  const items = damages.data?.items ?? [];

  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const damage of items) map[damage.panelCode] = (map[damage.panelCode] ?? 0) + 1;
    return map;
  }, [items]);

  const pdrMinor = items.reduce((sum, damage) => sum + (damage.priceMinor ?? 0), 0);
  const extrasMinor = items.reduce((sum, damage) => sum + damage.extrasMinor, 0);
  const totalMinor = pdrMinor + extrasMinor;

  const openNew = (code: string): void => {
    setPanelCode(code);
    setEditing(null);
    setSheetOpen(true);
    setHintScheme(false);
  };

  const openExisting = (damage: Damage): void => {
    setPanelCode(damage.panelCode);
    setEditing(damage);
    setSheetOpen(true);
  };

  if (damages.isLoading) return <SkeletonList rows={3} />;

  return (
    <div className="pdr-stack">
      <div ref={schemeRef}>
        <Card>
          <CarScheme
            counts={counts}
            onSelect={openNew}
            disabled={!canEdit}
            hint={
              canEdit
                ? hintScheme
                  ? 'Выберите деталь на схеме — откроется карточка повреждения.'
                  : 'Нажмите на деталь, чтобы отметить повреждение. Одну деталь можно отметить несколько раз.'
                : 'Схема доступна только для просмотра.'
            }
          />
        </Card>
      </div>

      <h2 className="pdr-subtitle">Отмеченные повреждения</h2>
      {items.length === 0 ? (
        <EmptyState
          title="Повреждений пока нет"
          description="Выберите деталь на схеме и опишите, что именно повреждено."
        />
      ) : (
        <Card flat>
          <div className="pdr-list">
            {items.map((damage) => (
              <button
                key={damage.id}
                type="button"
                className="pdr-list__item pdr-list__item--button"
                onClick={() => openExisting(damage)}
              >
                <span className="pdr-grow">
                  <span style={{ display: 'block', fontWeight: 600 }}>
                    {panelLabel(damage.panelCode) ?? damage.panelCode}
                  </span>
                  {/* Главное — то, что мастер измерил: тип и фактический размер. */}
                  <span className="pdr-hint" style={{ display: 'block' }}>
                    {[
                      damageTypeLabel(damage.damageType),
                      damage.sizeText,
                      damage.quantity > 1 ? `${damage.quantity} шт` : null,
                      damage.photoCount > 0 ? `фото: ${damage.photoCount}` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  {damage.priceMinor !== null || damage.extrasMinor > 0 ? (
                    <span className="pdr-hint" style={{ display: 'block' }}>
                      PDR {formatMinor(damage.priceMinor ?? 0, currency)}
                      {damage.extrasMinor > 0
                        ? ` + арматурка ${formatMinor(damage.extrasMinor, currency)}`
                        : ''}
                    </span>
                  ) : null}
                </span>
                {damage.totalMinor > 0 ? (
                  <span style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                    {formatMinor(damage.totalMinor, currency)}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </Card>
      )}

      {canEdit ? (
        <Button
          variant="secondary"
          block
          onClick={() => {
            // Кнопка ведёт к схеме, а не открывает карточку: деталь всё равно
            // надо выбрать, и выбирают её на машине.
            setHintScheme(true);
            schemeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }}
        >
          + Добавить ещё повреждение
        </Button>
      ) : null}

      {totalMinor > 0 ? (
        <Card>
          <div className="pdr-row">
            <span className="pdr-grow pdr-hint">Ремонт PDR</span>
            <span>{formatMinor(pdrMinor, currency)}</span>
          </div>
          {extrasMinor > 0 ? (
            <div className="pdr-row">
              <span className="pdr-grow pdr-hint">Арматурные работы</span>
              <span>{formatMinor(extrasMinor, currency)}</span>
            </div>
          ) : null}
          <div className="pdr-row" style={{ marginTop: 4 }}>
            <span className="pdr-grow" style={{ fontWeight: 600 }}>
              Сумма по отмеченным повреждениям
            </span>
            <span style={{ fontSize: 18, fontWeight: 700 }}>
              {formatMinor(totalMinor, currency)}
            </span>
          </div>
        </Card>
      ) : null}

      {panelCode ? (
        <DamageSheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          workspaceId={workspaceId}
          parent={parent}
          panelCode={panelCode}
          damage={editing}
          canEdit={canEdit}
          currency={currency}
        />
      ) : null}
    </div>
  );
}
