import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@pdr/api-client';
import { Badge, Button, Field, Input, Sheet, Spinner, Textarea } from '@pdr/ui';
import { api } from '@/shared/api';
import { formatTime } from '@/shared/format';
import { haptic } from '@/shared/telegram';
import { useAvailability, useMembers, useWorkspace } from './api';
import {
  APPOINTMENT_KIND_OPTIONS,
  type Appointment,
  type AppointmentKind,
  type OverlapConflict,
} from './types';

const DURATIONS = [30, 60, 90, 120, 180, 240];

function timeOf(local: string): string {
  return local.slice(11, 16);
}

function dayOf(local: string): string {
  return local.slice(0, 10);
}

export interface AppointmentSheetProps {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
  /** День по умолчанию в часовом поясе мастерской. */
  defaultDay: string;
  /** Редактирование существующей записи (перенос). */
  appointment?: Appointment | null;
  /** Привязка к заказу при создании. */
  orderId?: string | null;
  clientId?: string | null;
  onSaved?: () => void;
}

/**
 * Создание и перенос записи.
 *
 * Свободные слоты приходят с сервера: рабочие часы и занятость —
 * знание мастерской, а не экрана. Ручной ввод времени оставлен,
 * потому что срочную запись иногда нужно поставить вне сетки.
 */
export function AppointmentSheet({
  open,
  onClose,
  workspaceId,
  defaultDay,
  appointment = null,
  orderId = null,
  clientId = null,
  onSaved,
}: AppointmentSheetProps) {
  const queryClient = useQueryClient();
  const workspace = useWorkspace(workspaceId);
  const members = useMembers(workspaceId);
  const isEdit = Boolean(appointment);

  const [day, setDay] = useState(defaultDay);
  const [time, setTime] = useState('');
  const [durationMin, setDurationMin] = useState(60);
  const [kind, setKind] = useState<AppointmentKind>('repair');
  const [assigneeMemberId, setAssigneeMemberId] = useState<string>('');
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [conflicts, setConflicts] = useState<OverlapConflict[] | null>(null);
  const [canOverride, setCanOverride] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canAssignOthers = workspace.data?.permissions.includes('appointments.write_all') ?? false;
  const defaultMinutes = Number(workspace.data?.settings?.default_appointment_minutes ?? 60);

  useEffect(() => {
    if (!open) return;
    setConflicts(null);
    setError(null);
    if (appointment) {
      setDay(dayOf(appointment.startsAtLocal));
      setTime(timeOf(appointment.startsAtLocal));
      setDurationMin(appointment.durationMin);
      setKind(appointment.kind);
      setAssigneeMemberId(appointment.assignee?.id ?? '');
      setTitle(appointment.title ?? '');
      setNote(appointment.note ?? '');
    } else {
      setDay(defaultDay);
      setTime('');
      setDurationMin(defaultMinutes);
      setKind(orderId ? 'repair' : 'inspection');
      setAssigneeMemberId(workspace.data?.memberId ?? '');
      setTitle('');
      setNote('');
    }
  }, [open, appointment, defaultDay, defaultMinutes, orderId, workspace.data?.memberId]);

  const availability = useAvailability(workspaceId, {
    day,
    assigneeMemberId: assigneeMemberId || undefined,
    durationMin,
    stepMin: 30,
    excludeId: appointment?.id,
    enabled: open && Boolean(assigneeMemberId),
  });

  const slots = useMemo(
    () => availability.data?.slots.map((slot) => slot.startsAtLocal) ?? [],
    [availability.data],
  );

  const save = useMutation({
    mutationFn: async (input: { allowOverlap?: boolean }) => {
      const body = {
        startsAtLocal: `${day}T${time}`,
        durationMin,
        kind,
        title: title.trim() || null,
        note: note.trim() || null,
        ...(input.allowOverlap ? { allowOverlap: true } : {}),
      };
      if (appointment) {
        return api.patch(`/workspaces/${workspaceId}/appointments/${appointment.id}`, {
          ...body,
          assigneeMemberId: assigneeMemberId || null,
        });
      }
      return api.post(`/workspaces/${workspaceId}/appointments`, {
        ...body,
        assigneeMemberId: assigneeMemberId || null,
        orderId,
        clientId,
      });
    },
    onSuccess: async () => {
      haptic('success');
      await queryClient.invalidateQueries({ queryKey: ['crm'] });
      onSaved?.();
      onClose();
    },
    onError: (e) => {
      haptic('error');
      if (e instanceof ApiError && e.code === 'overlap') {
        const details = e.details as
          | { conflicts?: OverlapConflict[]; canOverride?: boolean }
          | undefined;
        setConflicts(details?.conflicts ?? []);
        setCanOverride(Boolean(details?.canOverride));
        setError(null);
        return;
      }
      setConflicts(null);
      setError(e instanceof ApiError ? e.message : 'Не удалось сохранить запись');
    },
  });

  const disabled = !time || !day || save.isPending;

  return (
    <Sheet open={open} onClose={onClose} title={isEdit ? 'Перенос записи' : 'Новая запись'}>
      <div className="pdr-stack">
        <Field label="Дата">
          <Input
            type="date"
            value={day}
            onChange={(e) => {
              setDay(e.target.value);
              setConflicts(null);
            }}
          />
        </Field>

        <Field label="Длительность">
          <div className="pdr-chips">
            {DURATIONS.map((value) => (
              <button
                key={value}
                type="button"
                className={`pdr-chip${durationMin === value ? ' pdr-chip--active' : ''}`}
                onClick={() => {
                  setDurationMin(value);
                  setConflicts(null);
                }}
              >
                {value < 60 ? `${value} мин` : `${value / 60} ч`}
              </button>
            ))}
          </div>
        </Field>

        {canAssignOthers && (members.data?.length ?? 0) > 1 ? (
          <Field label="Исполнитель">
            <div className="pdr-chips">
              {members.data!
                .filter((member) => member.isActive)
                .map((member) => (
                  <button
                    key={member.id}
                    type="button"
                    className={`pdr-chip${assigneeMemberId === member.id ? ' pdr-chip--active' : ''}`}
                    onClick={() => {
                      setAssigneeMemberId(member.id);
                      setConflicts(null);
                    }}
                  >
                    {member.name}
                  </button>
                ))}
            </div>
          </Field>
        ) : null}

        <Field
          label="Время"
          hint={
            availability.isLoading
              ? undefined
              : slots.length === 0
                ? 'Свободных слотов нет — выберите другой день или введите время вручную'
                : 'Показаны свободные слоты рабочего дня'
          }
        >
          {availability.isLoading ? (
            <Spinner />
          ) : (
            <div className="pdr-chips">
              {slots.map((slot) => (
                <button
                  key={slot}
                  type="button"
                  className={`pdr-chip${time === slot ? ' pdr-chip--active' : ''}`}
                  onClick={() => {
                    setTime(slot);
                    setConflicts(null);
                  }}
                >
                  {slot}
                </button>
              ))}
            </div>
          )}
          <Input
            type="time"
            value={time}
            style={{ marginTop: 8 }}
            onChange={(e) => {
              setTime(e.target.value);
              setConflicts(null);
            }}
          />
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

        {!orderId && !appointment?.order ? (
          <Field label="Кого ждём" hint="Заполните, если записи ещё не соответствует заказ">
            <Input
              value={title}
              placeholder="Иван, Camry, град"
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
        ) : null}

        <Field label="Заметка">
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>

        {conflicts ? (
          <div className="pdr-card">
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Время занято</div>
            {conflicts.map((conflict) => (
              <div key={conflict.id} className="pdr-hint">
                {formatTime(conflict.startsAt, workspace.data?.timezone)} —{' '}
                {conflict.clientName ??
                  conflict.title ??
                  (conflict.orderNumber ? `заказ №${conflict.orderNumber}` : 'другая запись')}
              </div>
            ))}
            {canOverride ? (
              <Button
                variant="secondary"
                block
                style={{ marginTop: 10 }}
                onClick={() => save.mutate({ allowOverlap: true })}
              >
                Всё равно записать
              </Button>
            ) : (
              <div className="pdr-hint" style={{ marginTop: 8 }}>
                Записать поверх занятого времени может только владелец.
              </div>
            )}
          </div>
        ) : null}

        {error ? <Badge tone="danger">{error}</Badge> : null}

        <Button block disabled={disabled} onClick={() => save.mutate({})}>
          {isEdit ? 'Перенести' : 'Записать'}
        </Button>
        <Button variant="secondary" block onClick={onClose}>
          Отмена
        </Button>
      </div>
    </Sheet>
  );
}
