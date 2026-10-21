import {
  VEHICLE_CONDITION_ITEMS,
  VEHICLE_CONDITION_LABELS,
  toggleVehicleCondition,
  type VehicleConditionItem,
} from '@pdr/shared';
import { Card, Field, Textarea } from '@pdr/ui';
import { haptic } from '@/shared/telegram';

/**
 * Чек-лист состояния автомобиля при приёмке и примечание к нему.
 *
 * Строка целиком — кнопка: на телефоне пункт отмечают одним касанием, не
 * целясь в маленький квадратик. «Грязный» и «чистый» взаимоисключающие:
 * отметка одного снимает другой.
 */
export function VehicleConditionCard({
  value,
  onChange,
  note,
  onNoteChange,
  onNoteBlur,
  disabled = false,
}: {
  value: readonly VehicleConditionItem[];
  onChange: (next: VehicleConditionItem[]) => void;
  note: string;
  onNoteChange: (next: string) => void;
  /** Карточка заказа сохраняет примечание, когда поле теряет фокус. */
  onNoteBlur?: () => void;
  disabled?: boolean;
}) {
  return (
    <>
      <Card flat>
        <div className="pdr-list" role="group" aria-label="Состояние автомобиля">
          {VEHICLE_CONDITION_ITEMS.map((item) => {
            const checked = value.includes(item);
            return (
              <button
                key={item}
                type="button"
                role="checkbox"
                aria-checked={checked}
                disabled={disabled}
                className="pdr-list__item pdr-list__item--button"
                onClick={() => {
                  haptic('select');
                  onChange(toggleVehicleCondition(value, item));
                }}
              >
                <span className={`pdr-check${checked ? ' pdr-check--on' : ''}`} aria-hidden>
                  ✓
                </span>
                <span className="pdr-grow">{VEHICLE_CONDITION_LABELS[item]}</span>
              </button>
            );
          })}
        </div>
      </Card>
      <Card>
        <Field label="Примечание">
          <Textarea
            value={note}
            onChange={(e) => onNoteChange(e.target.value)}
            onBlur={onNoteBlur}
            rows={3}
            disabled={disabled}
            placeholder="Царапина на бампере, в салоне детское кресло…"
          />
        </Field>
      </Card>
    </>
  );
}
