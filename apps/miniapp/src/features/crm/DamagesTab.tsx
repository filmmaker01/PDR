import { useMemo, useState } from 'react';
import { CarScheme, Card, EmptyState, ListItem, SkeletonList } from '@pdr/ui';
import { damageTypeLabel, panelLabel, sizeClassLabel } from '@pdr/shared';
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

  const items = damages.data?.items ?? [];

  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const damage of items) map[damage.panelCode] = (map[damage.panelCode] ?? 0) + 1;
    return map;
  }, [items]);

  const totalMinor = items.reduce((sum, damage) => sum + (damage.priceMinor ?? 0), 0);

  const openNew = (code: string): void => {
    setPanelCode(code);
    setEditing(null);
    setSheetOpen(true);
  };

  const openExisting = (damage: Damage): void => {
    setPanelCode(damage.panelCode);
    setEditing(damage);
    setSheetOpen(true);
  };

  if (damages.isLoading) return <SkeletonList rows={3} />;

  return (
    <div className="pdr-stack">
      <Card>
        <CarScheme
          counts={counts}
          onSelect={openNew}
          disabled={!canEdit}
          hint={
            canEdit
              ? 'Нажмите на деталь, чтобы отметить повреждение. Одну деталь можно отметить несколько раз.'
              : 'Схема доступна только для просмотра.'
          }
        />
      </Card>

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
              <ListItem
                key={damage.id}
                title={panelLabel(damage.panelCode) ?? damage.panelCode}
                subtitle={[
                  damageTypeLabel(damage.damageType),
                  damage.sizeClass ? `размер ${sizeClassLabel(damage.sizeClass)}` : null,
                  damage.widthMm && damage.heightMm
                    ? `${Math.round(damage.widthMm / 10)}×${Math.round(damage.heightMm / 10)} см`
                    : null,
                  damage.quantity > 1 ? `${damage.quantity} шт` : null,
                  damage.photoCount > 0 ? `фото: ${damage.photoCount}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                right={
                  damage.priceMinor !== null ? (
                    <span style={{ fontWeight: 600 }}>
                      {formatMinor(damage.priceMinor, currency)}
                    </span>
                  ) : null
                }
                onClick={() => openExisting(damage)}
              />
            ))}
          </div>
        </Card>
      )}

      {totalMinor > 0 ? (
        <Card>
          <div className="pdr-row">
            <span className="pdr-grow pdr-hint">Сумма по отмеченным повреждениям</span>
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
        />
      ) : null}
    </div>
  );
}
