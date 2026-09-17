import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@pdr/api-client';
import { Button, Field, Input, Sheet } from '@pdr/ui';
import { api } from '@/shared/api';
import { alertDialog, confirmDialog, haptic } from '@/shared/telegram';
import { APPOINTMENT_KIND_OPTIONS, type AppointmentKind } from './types';

/**
 * Запись клиента по обращению.
 *
 * Клиент и автомобиль заводятся на сервере из полей обращения, если их ещё
 * нет: мастер не заполняет карточку клиента второй раз, а обращение
 * переходит в «Записан».
 */
export function LeadScheduleSheet({
  open,
  onClose,
  workspaceId,
  leadId,
}: {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
  leadId: string;
}) {
  const queryClient = useQueryClient();
  const [day, setDay] = useState(() => new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState('10:00');
  const [durationMin, setDurationMin] = useState(60);
  const [kind, setKind] = useState<AppointmentKind>('inspection');
  const [note, setNote] = useState('');
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const schedule = useMutation({
    mutationFn: (options: { allowOverlap?: boolean } = {}) =>
      api.post(
        `/workspaces/${workspaceId}/leads/${leadId}/schedule`,
        {
          startsAtLocal: `${day}T${time}`,
          durationMin,
          kind,
          note: note.trim() || null,
          ...(options.allowOverlap ? { allowOverlap: true } : {}),
        },
        { idempotencyKey },
      ),
    onSuccess: async () => {
      haptic('success');
      await queryClient.invalidateQueries({ queryKey: ['crm'] });
      onClose();
    },
    onError: async (e) => {
      haptic('error');
      if (e instanceof ApiError && e.code === 'overlap') {
        const details = e.details as { canOverride?: boolean } | undefined;
        if (details?.canOverride) {
          const force = await confirmDialog(
            'В это время у исполнителя уже есть запись. Записать всё равно?',
          );
          if (force) schedule.mutate({ allowOverlap: true });
          return;
        }
        await alertDialog('В это время у исполнителя уже есть запись. Выберите другое время.');
        return;
      }
      await alertDialog(e instanceof ApiError ? e.message : 'Не удалось записать клиента');
    },
  });

  return (
    <Sheet open={open} onClose={onClose} title="Записать в календарь">
      <div className="pdr-stack">
        <div className="pdr-row">
          <Field label="Дата">
            <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
          </Field>
          <Field label="Время">
            <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
        </div>

        <Field label="Длительность">
          <select
            className="pdr-select"
            value={durationMin}
            onChange={(e) => setDurationMin(Number(e.target.value))}
          >
            {[30, 60, 90, 120, 180, 240].map((value) => (
              <option key={value} value={value}>
                {value < 60 ? `${value} мин` : `${value / 60} ч`}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Тип">
          <div className="pdr-chips">
            {APPOINTMENT_KIND_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`pdr-chip${kind === option.value ? ' pdr-chip--active' : ''}`}
                onClick={() => setKind(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Заметка">
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Что нужно сделать"
          />
        </Field>

        <Button
          block
          disabled={!day || !time}
          loading={schedule.isPending}
          onClick={() => schedule.mutate({})}
        >
          Записать
        </Button>
        <Button variant="secondary" block onClick={onClose}>
          Отмена
        </Button>
      </div>
    </Sheet>
  );
}
