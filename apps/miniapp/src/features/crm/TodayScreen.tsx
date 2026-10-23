import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import clsx from 'clsx';
import { Badge, Button, Card, EmptyState, MarkedImage, SkeletonList } from '@pdr/ui';
import { todayInZone, zonedTimeToUtc } from '@pdr/shared';
import {
  useAppointments,
  useLeads,
  useLeadsSummary,
  useOrderCounts,
  useOrders,
  useWorkspace,
} from './api';
import { CreateSheet, availableCreateActions } from './CreateSheet';
import { IconCar, IconChat, IconCheck, IconChevron, IconPlus, IconSearch } from './Icons';
import { openOrdersSearch, openOrdersTab, type OrdersTab } from './OrdersScreen';
import { ScreenError } from './ScreenError';
import {
  ACTIVE_ORDER_STATUSES,
  APPOINTMENT_STATUS_TONES,
  ORDER_STATUS_TABS,
  STATUS_TONES,
  type Appointment,
} from './types';

/** Сколько строк в каждом блоке главной: остальное — по ссылке «Все». */
const PREVIEW_ROWS = 4;
/** Записи на неделю вперёд: «ближайшие» — не только сегодняшние. */
const UPCOMING_DAYS = 7;

/**
 * Главная мастерской.
 *
 * Сверху — минимум высоты: поиск, три показателя и одна кнопка «Создать»,
 * за которой все действия. Ниже — то, с чем мастер работает сейчас:
 * ближайшие записи, активные заказы и последние обращения.
 *
 * Активными считаются все незакрытые заказы — и новые, и на согласовании:
 * заказ, переведённый в «На согласовании», не должен пропадать с главной.
 * Показатель «Активные» и полоса статусов ведут в нужную вкладку списка.
 * Задолженности здесь нет намеренно — в PDR работы оплачиваются сразу.
 */
export function TodayScreen() {
  const { workspaceId = '' } = useParams();
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);
  const [search, setSearch] = useState('');

  const counts = useOrderCounts(workspaceId);
  const workspace = useWorkspace(workspaceId);
  const active = useOrders(workspaceId, { status: ACTIVE_ORDER_STATUSES, withCover: true });
  const leadsSummary = useLeadsSummary(workspaceId);
  const leads = useLeads(workspaceId);

  const timezone = workspace.data?.timezone ?? 'Europe/Moscow';
  const today = todayInZone(timezone);
  const range = useMemo(() => {
    const from = zonedTimeToUtc(`${today}T00:00:00`, timezone);
    return {
      from: from.toISOString(),
      to: new Date(from.getTime() + UPCOMING_DAYS * 86_400_000).toISOString(),
    };
  }, [today, timezone]);
  const appointments = useAppointments(workspaceId, range);

  if (counts.isError) {
    return <ScreenError error={counts.error} onRetry={() => void counts.refetch()} />;
  }
  if (counts.isLoading) return <SkeletonList rows={4} />;

  const byStatus = counts.data!.counts;
  const activeTotal = ACTIVE_ORDER_STATUSES.reduce((sum, status) => sum + byStatus[status], 0);
  const permissions = workspace.data?.permissions ?? [];
  const canCreate =
    (workspace.data?.access.active ?? false) && availableCreateActions(permissions).length > 0;

  const openOrders = (tab: OrdersTab): void => {
    openOrdersTab(workspaceId, tab);
    navigate(`/workspace/${workspaceId}/orders`);
  };

  // Ближайшие записи: ещё не закончившиеся и не отменённые, по времени.
  const now = Date.now();
  const upcoming = (appointments.data?.items ?? [])
    .filter((a) => a.status !== 'cancelled' && new Date(a.endsAt).getTime() >= now)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .slice(0, PREVIEW_ROWS);

  const activeOrders = (active.data?.items ?? []).slice(0, PREVIEW_ROWS);
  const recentLeads = (leads.data?.items ?? []).slice(0, 3);
  const leadStats = leadsSummary.data;

  return (
    <div className="pdr-stack ws-stack">
      <form
        className="ws-search"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          const q = search.trim();
          if (!q) return;
          // Поиск ведёт в список заказов и идёт по всем статусам сразу.
          openOrdersSearch(workspaceId, q);
          navigate(`/workspace/${workspaceId}/orders`);
        }}
      >
        <IconSearch size={18} />
        <input
          type="search"
          enterKeyHint="search"
          placeholder="Клиент, номер, телефон, машина"
          aria-label="Поиск заказов"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </form>

      <div className="ws-stats">
        <button type="button" className="ws-stat" onClick={() => openOrders('active')}>
          <span className="ws-stat__label">Активные</span>
          <span className="ws-stat__value">
            {activeTotal}
            <IconCar size={20} style={{ color: 'var(--pdr-link)' }} />
          </span>
          {/* Заказы на согласовании названы отдельно: их чаще всего «теряли». */}
          {byStatus.pending_approval > 0 ? (
            <span className="ws-stat__note">{byStatus.pending_approval} на согласовании</span>
          ) : null}
        </button>
        <button type="button" className="ws-stat" onClick={() => openOrders('ready')}>
          <span className="ws-stat__label">К выдаче</span>
          <span className="ws-stat__value">
            {byStatus.ready}
            <IconCheck size={20} style={{ color: 'var(--pdr-success)' }} />
          </span>
        </button>
        <button
          type="button"
          className="ws-stat"
          onClick={() => navigate(`/workspace/${workspaceId}/leads`)}
        >
          <span className="ws-stat__label">Обращения</span>
          <span className="ws-stat__value">
            {leadStats?.total ?? '—'}
            <IconChat size={20} style={{ color: '#ff9500' }} />
          </span>
          {leadStats && leadStats.due > 0 ? (
            <span className="ws-stat__note">{leadStats.due} просрочено</span>
          ) : null}
        </button>
      </div>

      {/* Каждый рабочий статус — одним касанием, без захода в список. */}
      <div className="ws-strip" aria-label="Заказы по статусам">
        {ACTIVE_ORDER_STATUSES.map((status) => (
          <button
            key={status}
            type="button"
            className={clsx('pdr-chip', byStatus[status] === 0 && 'ws-chip--empty')}
            onClick={() => openOrders(status)}
          >
            {ORDER_STATUS_TABS[status]} · {byStatus[status]}
          </button>
        ))}
      </div>

      {canCreate ? (
        <Button block className="ws-create" onClick={() => setCreateOpen(true)}>
          <IconPlus size={20} /> Создать
        </Button>
      ) : null}

      <div className="ws-section-head">
        <h2 className="pdr-subtitle">Ближайшие записи</h2>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => navigate(`/workspace/${workspaceId}/calendar`)}
        >
          Все
        </Button>
      </div>
      {appointments.isLoading ? (
        <SkeletonList rows={2} />
      ) : upcoming.length === 0 ? (
        <Card>
          <div className="pdr-hint">На неделю вперёд записей нет.</div>
        </Card>
      ) : (
        <Card flat>
          {upcoming.map((appointment) => (
            <AppointmentRow
              key={appointment.id}
              appointment={appointment}
              today={today}
              onOpen={() =>
                navigate(
                  appointment.order
                    ? `/workspace/${workspaceId}/orders/${appointment.order.id}`
                    : `/workspace/${workspaceId}/calendar`,
                )
              }
            />
          ))}
        </Card>
      )}

      <div className="ws-section-head">
        <h2 className="pdr-subtitle">Активные заказы · {activeTotal}</h2>
        <Button size="sm" variant="ghost" onClick={() => openOrders('active')}>
          Все
        </Button>
      </div>
      {active.isLoading ? (
        <SkeletonList rows={3} />
      ) : activeOrders.length === 0 ? (
        <EmptyState
          title="Активных заказов нет"
          description="Создайте заказ, когда клиент приедет на осмотр."
        />
      ) : (
        <Card flat>
          {activeOrders.map((order) => (
            <button
              key={order.id}
              type="button"
              className="ws-row"
              onClick={() => navigate(`/workspace/${workspaceId}/orders/${order.id}`)}
            >
              <span className="ws-row__thumb">
                {order.cover?.thumbUrl ? (
                  <MarkedImage
                    src={order.cover.thumbUrl}
                    markup={order.cover.annotation}
                    style={{ width: '100%', height: '100%' }}
                    fallback={<IconCar size={26} />}
                  />
                ) : (
                  <IconCar size={26} />
                )}
              </span>
              <span className="ws-row__body">
                <span className="ws-row__title">
                  №{order.number} · {order.client.name}
                </span>
                {order.vehicle ? (
                  <span className="ws-row__line">
                    {order.vehicle.make} {order.vehicle.model}
                    {order.vehicle.plate ? ` · ${order.vehicle.plate}` : ''}
                  </span>
                ) : null}
                {order.title || order.assignee ? (
                  <span className="ws-row__line">
                    {[order.title, order.assignee?.name].filter(Boolean).join(' · ')}
                  </span>
                ) : null}
              </span>
              <span className="ws-row__side">
                <Badge tone={STATUS_TONES[order.status]}>{order.statusLabel}</Badge>
              </span>
            </button>
          ))}
        </Card>
      )}

      {recentLeads.length > 0 ? (
        <>
          <div className="ws-section-head">
            <h2 className="pdr-subtitle">Последние обращения</h2>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => navigate(`/workspace/${workspaceId}/leads`)}
            >
              Все
            </Button>
          </div>
          <Card flat>
            {recentLeads.map((lead) => (
              <button
                key={lead.id}
                type="button"
                className="ws-row"
                onClick={() => navigate(`/workspace/${workspaceId}/leads/${lead.id}`)}
              >
                <span className="ws-row__avatar">
                  <IconChat size={18} />
                </span>
                <span className="ws-row__body">
                  <span className="ws-row__title">
                    {lead.contact.name ?? lead.contact.phone ?? `Обращение №${lead.number}`}
                  </span>
                  <span className="ws-row__line">
                    {lead.comment ??
                      ([lead.vehicle.make, lead.vehicle.model].filter(Boolean).join(' ') ||
                        lead.statusLabel)}
                  </span>
                </span>
                <span className="ws-row__side">
                  <span className="pdr-hint" style={{ fontSize: 12 }}>
                    {shortWhen(lead.createdAt, today, timezone)}
                  </span>
                </span>
              </button>
            ))}
          </Card>
        </>
      ) : null}

      <CreateSheet
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        workspaceId={workspaceId}
        permissions={permissions}
      />
    </div>
  );
}

/** «10:30» для сегодняшнего, «24.10» для остальных дней — в часовом поясе мастерской. */
function shortWhen(iso: string, today: string, timezone: string): string {
  const at = new Date(iso);
  const day = at.toLocaleDateString('sv-SE', { timeZone: timezone });
  if (day === today) {
    return at.toLocaleTimeString('ru-RU', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  return at.toLocaleDateString('ru-RU', { timeZone: timezone, day: '2-digit', month: '2-digit' });
}

/** «пт, 24.10» — для записи не на сегодня. */
function weekdayDate(localDate: string): string {
  const at = new Date(`${localDate}T12:00:00Z`);
  return at.toLocaleDateString('ru-RU', {
    timeZone: 'UTC',
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
  });
}

function AppointmentRow({
  appointment,
  today,
  onOpen,
}: {
  appointment: Appointment;
  today: string;
  onOpen: () => void;
}) {
  const day = appointment.startsAtLocal.slice(0, 10);
  const time = appointment.startsAtLocal.slice(11, 16);
  const vehicle = appointment.order?.vehicle ?? null;
  const tone = APPOINTMENT_STATUS_TONES[appointment.status];

  return (
    <button type="button" className="ws-row" onClick={onOpen}>
      <span className="ws-row__time">
        <span
          className="ws-row__dot"
          style={{
            background:
              tone === 'success'
                ? 'var(--pdr-success)'
                : tone === 'warning'
                  ? 'var(--pdr-warning)'
                  : 'var(--pdr-link)',
          }}
        />
        <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15 }}>
          {time}
          {day !== today ? (
            <span className="pdr-hint" style={{ fontSize: 11, fontWeight: 500 }}>
              {weekdayDate(day)}
            </span>
          ) : null}
        </span>
      </span>
      <span className="ws-row__body">
        <span className="ws-row__title">
          {vehicle
            ? `${vehicle.make} ${vehicle.model}${vehicle.plate ? ` · ${vehicle.plate}` : ''}`
            : (appointment.client?.name ?? appointment.title ?? 'Без клиента')}
        </span>
        <span className="ws-row__line">
          {[
            vehicle ? appointment.client?.name : null,
            appointment.order?.title ?? appointment.title,
            appointment.kindLabel,
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </span>
      <IconChevron className="ws-chevron" size={16} />
    </button>
  );
}
