import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Badge, Button, Card, EmptyState, ListItem, SkeletonList } from '@pdr/ui';
import { todayInZone, zonedTimeToUtc } from '@pdr/shared';
import { plural } from '@/shared/format';
import { useAppointments, useLeadsSummary, useOrderCounts, useOrders, useWorkspace } from './api';
import { openOrdersTab, type OrdersTab } from './OrdersScreen';
import { ScreenError } from './ScreenError';
import {
  ACTIVE_ORDER_STATUSES,
  APPOINTMENT_STATUS_TONES,
  ORDER_STATUS_TABS,
  STATUS_TONES,
} from './types';

/**
 * Главная мастерской.
 *
 * Показывает то, чем мастер занимается прямо сейчас: заказы по рабочим
 * статусам, кто обратился и кого ждём сегодня. Активными считаются все
 * незакрытые заказы — и новые, и на согласовании: иначе заказ, переведённый
 * в «На согласовании», пропадал с главной, хотя работа по нему не кончилась.
 * Задолженности здесь нет намеренно — в PDR работы оплачиваются сразу.
 */
export function TodayScreen() {
  const { workspaceId = '' } = useParams();
  const navigate = useNavigate();

  const counts = useOrderCounts(workspaceId);
  const workspace = useWorkspace(workspaceId);
  const active = useOrders(workspaceId, { status: ACTIVE_ORDER_STATUSES });
  const leads = useLeadsSummary(workspaceId);

  const timezone = workspace.data?.timezone ?? 'Europe/Moscow';
  const todayRange = useMemo(() => {
    const day = todayInZone(timezone);
    const from = zonedTimeToUtc(`${day}T00:00:00`, timezone);
    return { from: from.toISOString(), to: new Date(from.getTime() + 86_400_000).toISOString() };
  }, [timezone]);
  const appointments = useAppointments(workspaceId, todayRange);

  if (counts.isError) {
    return <ScreenError error={counts.error} onRetry={() => void counts.refetch()} />;
  }

  if (counts.isLoading) return <SkeletonList rows={3} />;

  const byStatus = counts.data!.counts;
  const activeTotal = ACTIVE_ORDER_STATUSES.reduce((sum, status) => sum + byStatus[status], 0);
  const leadStats = leads.data;

  /** Список заказов сразу на нужной вкладке. */
  const openOrders = (tab: OrdersTab): void => {
    openOrdersTab(workspaceId, tab);
    navigate(`/workspace/${workspaceId}/orders`);
  };

  return (
    <div className="pdr-stack">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {/* Мастер почти всегда начинает с заказа: клиент уже приехал. Обращение —
            для тех, кто пока только написал и думает. */}
        <Button block onClick={() => navigate(`/workspace/${workspaceId}/orders/new`)}>
          + Заказ
        </Button>
        <Button
          variant="secondary"
          block
          onClick={() => navigate(`/workspace/${workspaceId}/leads/new`)}
        >
          + Обращение
        </Button>
      </div>

      {/* Все рабочие статусы с количеством: видно, где каждый заказ, и
          одним нажатием открывается нужная вкладка списка. */}
      <Card flat>
        <div className="pdr-list">
          {ACTIVE_ORDER_STATUSES.map((status) => (
            <ListItem
              key={status}
              title={ORDER_STATUS_TABS[status]}
              right={
                <Badge tone={byStatus[status] > 0 ? STATUS_TONES[status] : 'muted'}>
                  {byStatus[status]}
                </Badge>
              }
              onClick={() => openOrders(status)}
            />
          ))}
        </div>
      </Card>

      <Card>
        <button
          type="button"
          style={{ all: 'unset', display: 'block', width: '100%', cursor: 'pointer' }}
          onClick={() => navigate(`/workspace/${workspaceId}/leads`)}
        >
          <div className="pdr-row">
            <span className="pdr-grow">
              <span style={{ display: 'block', fontWeight: 600 }}>
                Обращения — {leadStats?.total ?? 0}
              </span>
              <span className="pdr-hint">
                {leadStats
                  ? [
                      `${leadStats.byStatus.new ?? 0} ${plural(leadStats.byStatus.new ?? 0, ['новое', 'новых', 'новых'])}`,
                      `${leadStats.byStatus.estimated ?? 0} ${plural(leadStats.byStatus.estimated ?? 0, ['оценено', 'оценены', 'оценено'])}`,
                      `${leadStats.byStatus.callback ?? 0} перезвонить`,
                    ].join(' · ')
                  : 'загружаем…'}
              </span>
            </span>
            {leadStats && leadStats.due > 0 ? (
              <Badge tone="warning">{leadStats.due} просрочено</Badge>
            ) : null}
          </div>
        </button>
      </Card>

      <h2 className="pdr-subtitle">Записи на сегодня</h2>
      {appointments.isLoading ? (
        <SkeletonList rows={2} />
      ) : (appointments.data?.items.length ?? 0) === 0 ? (
        <EmptyState title="На сегодня записей нет" description="Запишите клиента в календаре." />
      ) : (
        <Card flat>
          <div className="pdr-list">
            {appointments.data!.items.map((appointment) => (
              <ListItem
                key={appointment.id}
                title={`${appointment.startsAtLocal.slice(11, 16)} · ${
                  appointment.client?.name ?? appointment.title ?? 'Без клиента'
                }`}
                subtitle={[
                  appointment.kindLabel,
                  appointment.order ? `заказ №${appointment.order.number}` : null,
                  appointment.assignee?.name,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                right={
                  <Badge tone={APPOINTMENT_STATUS_TONES[appointment.status]}>
                    {appointment.statusLabel}
                  </Badge>
                }
                onClick={() =>
                  navigate(
                    appointment.order
                      ? `/workspace/${workspaceId}/orders/${appointment.order.id}`
                      : `/workspace/${workspaceId}/calendar`,
                  )
                }
              />
            ))}
          </div>
        </Card>
      )}

      <div className="pdr-row">
        <h2 className="pdr-subtitle pdr-grow">Активные заказы · {activeTotal}</h2>
        <Button size="sm" variant="ghost" onClick={() => openOrders('active')}>
          Все заказы
        </Button>
      </div>
      {active.isLoading ? (
        <SkeletonList rows={3} />
      ) : (active.data?.items.length ?? 0) === 0 ? (
        <EmptyState
          title="Активных заказов нет"
          description="Создайте заказ, когда клиент приедет на осмотр."
        />
      ) : (
        <Card flat>
          <div className="pdr-list">
            {active.data!.items.map((order) => (
              <ListItem
                key={order.id}
                title={`№${order.number} · ${order.client.name}`}
                subtitle={[
                  order.vehicle
                    ? `${order.vehicle.make} ${order.vehicle.model}${order.vehicle.plate ? `, ${order.vehicle.plate}` : ''}`
                    : null,
                  order.title,
                  order.assignee?.name,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                right={<Badge tone={STATUS_TONES[order.status]}>{order.statusLabel}</Badge>}
                onClick={() => navigate(`/workspace/${workspaceId}/orders/${order.id}`)}
              />
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
