import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Badge, Button, Card, EmptyState, ListItem, SkeletonList } from '@pdr/ui';
import { todayInZone, zonedTimeToUtc } from '@pdr/shared';
import { plural } from '@/shared/format';
import { useAppointments, useLeadsSummary, useOrders, useToday, useWorkspace } from './api';
import { ScreenError } from './ScreenError';
import { APPOINTMENT_STATUS_TONES, STATUS_TONES } from './types';

/**
 * Главная мастерской.
 *
 * Показывает только то, чем мастер занимается прямо сейчас: что в работе, что
 * готово к выдаче, кто обратился и кого ждём сегодня. Задолженности здесь нет
 * намеренно — в PDR работы оплачиваются сразу, и этот показатель не помогал.
 */
export function TodayScreen() {
  const { workspaceId = '' } = useParams();
  const navigate = useNavigate();

  const summary = useToday(workspaceId);
  const workspace = useWorkspace(workspaceId);
  const active = useOrders(workspaceId, { status: ['in_progress', 'ready'] });
  const leads = useLeadsSummary(workspaceId);

  const timezone = workspace.data?.timezone ?? 'Europe/Moscow';
  const todayRange = useMemo(() => {
    const day = todayInZone(timezone);
    const from = zonedTimeToUtc(`${day}T00:00:00`, timezone);
    return { from: from.toISOString(), to: new Date(from.getTime() + 86_400_000).toISOString() };
  }, [timezone]);
  const appointments = useAppointments(workspaceId, todayRange);

  if (summary.isError) {
    return <ScreenError error={summary.error} onRetry={() => void summary.refetch()} />;
  }

  if (summary.isLoading) return <SkeletonList rows={3} />;

  const data = summary.data!;
  const leadStats = leads.data;

  return (
    <div className="pdr-stack">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <Button block onClick={() => navigate(`/workspace/${workspaceId}/leads/new`)}>
          + Обращение
        </Button>
        <Button
          variant="secondary"
          block
          onClick={() => navigate(`/workspace/${workspaceId}/orders/new`)}
        >
          + Заказ
        </Button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <Card>
          <div className="pdr-hint">В работе</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{data.activeCount}</div>
        </Card>
        <Card>
          <div className="pdr-hint">Готовы к выдаче</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{data.readyCount}</div>
        </Card>
      </div>

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

      <h2 className="pdr-subtitle">Активные заказы</h2>
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
