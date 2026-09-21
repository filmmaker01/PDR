import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@pdr/api-client';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ListItem,
  MonthCalendar,
  Sheet,
  SkeletonList,
  Tabs,
} from '@pdr/ui';
import { todayInZone, zonedTimeToUtc } from '@pdr/shared';
import { api } from '@/shared/api';
import { alertDialog, haptic } from '@/shared/telegram';
import { useAppointmentMonth, useAppointments, useMembers, useWorkspace } from './api';
import { AppointmentSheet } from './AppointmentSheet';
import { ScreenError } from './ScreenError';
import { APPOINTMENT_STATUS_TONES, type Appointment, type AppointmentStatus } from './types';

type View = 'day' | 'week';

function shiftDay(day: string, days: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function startOfWeek(day: string): string {
  const date = new Date(`${day}T12:00:00Z`);
  const weekday = (date.getUTCDay() + 6) % 7; // понедельник — первый день
  return shiftDay(day, -weekday);
}

function formatDayTitle(day: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
  }).format(new Date(`${day}T12:00:00Z`));
}

function describe(appointment: Appointment): string {
  if (appointment.order) {
    const vehicle = appointment.order.vehicle;
    return [
      `№${appointment.order.number}`,
      appointment.client?.name,
      vehicle ? `${vehicle.make} ${vehicle.model}` : null,
    ]
      .filter(Boolean)
      .join(' · ');
  }
  return appointment.client?.name ?? appointment.title ?? 'Запись без заказа';
}

/** Календарь мастерской: день и неделя, фильтр по исполнителям. */
export function CalendarScreen() {
  const { workspaceId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const workspace = useWorkspace(workspaceId);
  const members = useMembers(workspaceId);
  const timezone = workspace.data?.timezone ?? 'Europe/Moscow';

  const [view, setView] = useState<View>('day');
  const [anchor, setAnchor] = useState(() => todayInZone(timezone));
  const [assigneeMemberId, setAssigneeMemberId] = useState<string | null>(null);
  const [monthOpen, setMonthOpen] = useState(false);
  const [month, setMonth] = useState(() => todayInZone(timezone).slice(0, 7));
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<Appointment | null>(null);
  const [rescheduling, setRescheduling] = useState<Appointment | null>(null);

  const days = useMemo(() => {
    if (view === 'day') return [anchor];
    const first = startOfWeek(anchor);
    return Array.from({ length: 7 }, (_, i) => shiftDay(first, i));
  }, [view, anchor]);

  const range = useMemo(() => {
    const from = zonedTimeToUtc(`${days[0]!}T00:00:00`, timezone);
    const to = zonedTimeToUtc(`${shiftDay(days.at(-1)!, 1)}T00:00:00`, timezone);
    return { from: from.toISOString(), to: to.toISOString() };
  }, [days, timezone]);

  const appointments = useAppointments(workspaceId, {
    ...range,
    assigneeMemberId: assigneeMemberId ?? undefined,
  });

  // Индикаторы месяца грузятся только когда календарь открыт: в листинге дня
  // они не нужны, а на телефоне лишний запрос заметен.
  const monthDays = useAppointmentMonth(
    workspaceId,
    month,
    assigneeMemberId ?? undefined,
    monthOpen,
  );
  const monthCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const day of monthDays.data?.days ?? []) map[day.day] = day.active;
    return map;
  }, [monthDays.data]);

  const setStatus = useMutation({
    mutationFn: (input: { id: string; to: AppointmentStatus; reason?: string }) =>
      api.post(`/workspaces/${workspaceId}/appointments/${input.id}/status`, {
        to: input.to,
        reason: input.reason,
      }),
    onSuccess: async () => {
      haptic('success');
      setSelected(null);
      await queryClient.invalidateQueries({ queryKey: ['crm'] });
    },
    onError: async (e) => {
      haptic('error');
      await alertDialog(e instanceof ApiError ? e.message : 'Не удалось изменить статус записи');
    },
  });

  const byDay = useMemo(() => {
    const map = new Map<string, Appointment[]>();
    for (const day of days) map.set(day, []);
    for (const item of appointments.data?.items ?? []) {
      const day = item.startsAtLocal.slice(0, 10);
      if (!map.has(day)) map.set(day, []);
      map.get(day)!.push(item);
    }
    return map;
  }, [appointments.data, days]);

  const today = todayInZone(timezone);

  if (appointments.isError) {
    return <ScreenError error={appointments.error} onRetry={() => void appointments.refetch()} />;
  }

  return (
    <div className="pdr-stack">
      <Tabs
        tabs={[
          { value: 'day', label: 'День' },
          { value: 'week', label: 'Неделя' },
        ]}
        value={view}
        onChange={setView}
      />

      <div className="pdr-row">
        <Button
          variant="secondary"
          onClick={() => setAnchor(shiftDay(anchor, view === 'day' ? -1 : -7))}
        >
          ←
        </Button>
        {/* Нажатие на дату открывает месяц целиком: листать дни по одному
            стрелками — это не выбор даты, а перебор. */}
        <button
          type="button"
          className="pdr-grow"
          style={{ all: 'unset', flex: 1, textAlign: 'center', cursor: 'pointer', fontWeight: 600 }}
          onClick={() => {
            setMonth(anchor.slice(0, 7));
            setMonthOpen(true);
          }}
        >
          {view === 'day'
            ? formatDayTitle(anchor)
            : `${formatDayTitle(days[0]!)} — ${formatDayTitle(days.at(-1)!)}`}
          <span className="pdr-hint" style={{ display: 'block', fontWeight: 400 }}>
            выбрать дату
          </span>
        </button>
        <Button
          variant="secondary"
          onClick={() => setAnchor(shiftDay(anchor, view === 'day' ? 1 : 7))}
        >
          →
        </Button>
      </div>

      {(members.data?.length ?? 0) > 1 ? (
        <div className="pdr-chips">
          <button
            type="button"
            className={`pdr-chip${assigneeMemberId === null ? ' pdr-chip--active' : ''}`}
            onClick={() => setAssigneeMemberId(null)}
          >
            Все
          </button>
          {members
            .data!.filter((member) => member.isActive)
            .map((member) => (
              <button
                key={member.id}
                type="button"
                className={`pdr-chip${assigneeMemberId === member.id ? ' pdr-chip--active' : ''}`}
                onClick={() => setAssigneeMemberId(member.id)}
              >
                {member.name}
              </button>
            ))}
        </div>
      ) : null}

      <Button block onClick={() => setCreateOpen(true)}>
        + Новая запись
      </Button>

      {appointments.isLoading ? (
        <SkeletonList rows={4} />
      ) : (appointments.data?.items.length ?? 0) === 0 ? (
        <EmptyState
          title="Записей нет"
          description={
            view === 'day' ? 'В этот день никто не записан.' : 'На этой неделе записей нет.'
          }
        />
      ) : (
        days.map((day) => {
          const items = byDay.get(day) ?? [];
          if (view === 'week' && items.length === 0) return null;
          return (
            <div key={day}>
              {view === 'week' ? (
                <h2 className="pdr-subtitle">
                  {formatDayTitle(day)}
                  {day === today ? ' · сегодня' : ''}
                </h2>
              ) : null}
              <Card flat>
                <div className="pdr-list">
                  {items.map((appointment) => (
                    <ListItem
                      key={appointment.id}
                      title={
                        <span>
                          <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                            {appointment.startsAtLocal.slice(11, 16)}–
                            {appointment.endsAtLocal.slice(11, 16)}
                          </span>{' '}
                          · {describe(appointment)}
                        </span>
                      }
                      subtitle={[
                        appointment.kindLabel,
                        appointment.assignee?.name,
                        appointment.note,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                      right={
                        <Badge tone={APPOINTMENT_STATUS_TONES[appointment.status]}>
                          {appointment.statusLabel}
                        </Badge>
                      }
                      onClick={() => setSelected(appointment)}
                    />
                  ))}
                </div>
              </Card>
            </div>
          );
        })
      )}

      <Sheet open={monthOpen} onClose={() => setMonthOpen(false)} title="Выбор даты">
        <div className="pdr-stack">
          <MonthCalendar
            month={month}
            selected={anchor}
            today={today}
            counts={monthCounts}
            onSelect={(day) => {
              // Выбор даты открывает именно этот день со списком записей:
              // создать запись оттуда — один тап.
              setAnchor(day);
              setView('day');
              setMonthOpen(false);
            }}
            onMonthChange={setMonth}
          />
          <div className="pdr-hint">
            Точки под числом — записи в этот день. Отменённые и неявки не считаются.
          </div>
          <Button
            variant="secondary"
            block
            onClick={() => {
              setAnchor(today);
              setView('day');
              setMonth(today.slice(0, 7));
              setMonthOpen(false);
            }}
          >
            Сегодня
          </Button>
          <Button variant="ghost" block onClick={() => setMonthOpen(false)}>
            Закрыть
          </Button>
        </div>
      </Sheet>

      <AppointmentSheet
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        workspaceId={workspaceId}
        defaultDay={anchor}
      />

      <AppointmentSheet
        open={Boolean(rescheduling)}
        onClose={() => setRescheduling(null)}
        workspaceId={workspaceId}
        defaultDay={anchor}
        appointment={rescheduling}
      />

      <Sheet
        open={Boolean(selected) && !rescheduling}
        onClose={() => setSelected(null)}
        title={selected ? describe(selected) : undefined}
      >
        {selected ? (
          <div className="pdr-stack">
            <div className="pdr-hint">
              {formatDayTitle(selected.startsAtLocal.slice(0, 10))},{' '}
              {selected.startsAtLocal.slice(11, 16)}–{selected.endsAtLocal.slice(11, 16)} ·{' '}
              {selected.kindLabel}
              {selected.assignee ? ` · ${selected.assignee.name}` : ''}
            </div>
            {selected.note ? <div>{selected.note}</div> : null}
            {selected.cancelReason ? (
              <div className="pdr-hint">Причина: {selected.cancelReason}</div>
            ) : null}

            {selected.order ? (
              <Button
                variant="secondary"
                block
                onClick={() => navigate(`/workspace/${workspaceId}/orders/${selected.order!.id}`)}
              >
                Открыть заказ №{selected.order.number}
              </Button>
            ) : null}

            {selected.allowedTransitions.map((transition) => (
              <Button
                key={transition.status}
                variant={transition.status === 'cancelled' ? 'danger' : 'secondary'}
                block
                disabled={setStatus.isPending}
                onClick={() =>
                  setStatus.mutate({
                    id: selected.id,
                    to: transition.status,
                    reason:
                      transition.status === 'cancelled' || transition.status === 'no_show'
                        ? 'Отмена из календаря'
                        : undefined,
                  })
                }
              >
                {transition.label}
              </Button>
            ))}

            {selected.status === 'planned' || selected.status === 'confirmed' ? (
              <Button block onClick={() => setRescheduling(selected)}>
                Перенести
              </Button>
            ) : null}
          </div>
        ) : null}
      </Sheet>
    </div>
  );
}
