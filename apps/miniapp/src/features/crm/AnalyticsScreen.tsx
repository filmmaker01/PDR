import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, Card, EmptyState, SkeletonList } from '@pdr/ui';
import { todayInZone } from '@pdr/shared';
import { formatDuration, formatMinor } from '@/shared/format';
import {
  useAnalyticsEmployees,
  useAnalyticsSeries,
  useAnalyticsSummary,
  useMembers,
  useWorkspace,
} from './api';

const PERIODS: { value: string; label: string; days: number }[] = [
  { value: 'week', label: 'Неделя', days: 7 },
  { value: 'month', label: 'Месяц', days: 30 },
  { value: 'quarter', label: 'Квартал', days: 90 },
];

function shiftDay(day: string, days: number): string {
  return new Date(new Date(`${day}T12:00:00Z`).getTime() + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** Аналитика мастерской: сводка за период, динамика и вклад исполнителей. */
export function AnalyticsScreen() {
  const { workspaceId = '' } = useParams();
  const navigate = useNavigate();
  const workspace = useWorkspace(workspaceId);
  const members = useMembers(workspaceId);

  const [periodValue, setPeriodValue] = useState('month');
  const [assigneeMemberId, setAssigneeMemberId] = useState<string | null>(null);

  const timezone = workspace.data?.timezone ?? 'Europe/Moscow';
  const period = useMemo(() => {
    const days = PERIODS.find((p) => p.value === periodValue)?.days ?? 30;
    const to = todayInZone(timezone);
    return { from: shiftDay(to, -(days - 1)), to };
  }, [periodValue, timezone]);

  const query = { ...period, ...(assigneeMemberId ? { assigneeMemberId } : {}) };
  const summary = useAnalyticsSummary(workspaceId, query);
  const series = useAnalyticsSeries(workspaceId, {
    ...query,
    granularity: periodValue === 'quarter' ? 'week' : 'day',
  });
  const employees = useAnalyticsEmployees(workspaceId, period);

  const currency = workspace.data?.currency ?? 'RUB';
  const points = series.data?.points ?? [];
  const maxReceived = Math.max(1, ...points.map((point) => point.receivedMinor));

  return (
    <div className="pdr-stack">
      <h1 className="pdr-title">Аналитика</h1>

      <div className="pdr-chips">
        {PERIODS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={`pdr-chip${periodValue === option.value ? ' pdr-chip--active' : ''}`}
            onClick={() => setPeriodValue(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {(members.data?.length ?? 0) > 1 ? (
        <div className="pdr-chips">
          <button
            type="button"
            className={`pdr-chip${assigneeMemberId === null ? ' pdr-chip--active' : ''}`}
            onClick={() => setAssigneeMemberId(null)}
          >
            Вся мастерская
          </button>
          {members.data!.map((member) => (
            <button
              key={member.id}
              type="button"
              className={`pdr-chip${assigneeMemberId === member.id ? ' pdr-chip--active' : ''}`}
              onClick={() => setAssigneeMemberId(assigneeMemberId === member.id ? null : member.id)}
            >
              {member.name}
            </button>
          ))}
        </div>
      ) : null}

      {summary.isLoading ? (
        <SkeletonList rows={3} />
      ) : summary.data ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <Card>
              <div className="pdr-hint">Поступления</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>
                {formatMinor(summary.data.receivedMinor, currency)}
              </div>
            </Card>
            <Card>
              <div className="pdr-hint">Завершено заказов</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{summary.data.completedOrders}</div>
            </Card>
            <Card>
              <div className="pdr-hint">Средний чек</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>
                {formatMinor(summary.data.averageCheckMinor, currency)}
              </div>
            </Card>
            <Card>
              <div className="pdr-hint">Задолженность</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>
                {formatMinor(summary.data.outstandingDebtMinor, currency)}
              </div>
            </Card>
          </div>

          <Card>
            <div className="pdr-stack" style={{ gap: 6 }}>
              <div className="pdr-row">
                <span className="pdr-grow pdr-hint">Сумма завершённых заказов</span>
                <span>{formatMinor(summary.data.completedTotalMinor, currency)}</span>
              </div>
              <div className="pdr-row">
                <span className="pdr-grow pdr-hint">Новых клиентов</span>
                <span>{summary.data.newClients}</span>
              </div>
              <div className="pdr-row">
                <span className="pdr-grow pdr-hint">Занято в календаре</span>
                <span>{formatDuration(summary.data.appointmentMinutes)}</span>
              </div>
            </div>
          </Card>
        </>
      ) : null}

      <h2 className="pdr-subtitle">Динамика поступлений</h2>
      {series.isLoading ? (
        <SkeletonList rows={2} />
      ) : points.length === 0 ? (
        <EmptyState title="Данных за период нет" />
      ) : (
        <Card>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 120 }}>
            {points.map((point) => (
              <div
                key={point.bucket}
                title={`${point.bucket}: ${formatMinor(point.receivedMinor, currency)}`}
                style={{
                  flex: 1,
                  minWidth: 3,
                  height: `${Math.max(2, (point.receivedMinor / maxReceived) * 100)}%`,
                  background: 'var(--pdr-accent, #2f80ed)',
                  borderRadius: 3,
                }}
              />
            ))}
          </div>
          <div className="pdr-row" style={{ marginTop: 6 }}>
            <span className="pdr-hint pdr-grow">{points[0]?.bucket}</span>
            <span className="pdr-hint">{points.at(-1)?.bucket}</span>
          </div>
        </Card>
      )}

      <h2 className="pdr-subtitle">Исполнители</h2>
      {employees.isLoading ? (
        <SkeletonList rows={2} />
      ) : (employees.data?.rows.length ?? 0) === 0 ? (
        <EmptyState title="Завершённых заказов за период нет" />
      ) : (
        <Card flat>
          <div className="pdr-list">
            {employees.data!.rows.map((row) => (
              <div key={row.memberId ?? 'none'} className="pdr-list__item pdr-list__item--static">
                <span className="pdr-grow">
                  <span style={{ display: 'block', fontWeight: 500 }}>{row.name}</span>
                  <span className="pdr-hint">
                    {row.completedOrders} заказ(ов) ·{' '}
                    {formatMinor(row.completedTotalMinor, currency)} · получено{' '}
                    {formatMinor(row.receivedMinor, currency)} ·{' '}
                    {formatDuration(row.appointmentMinutes)} в календаре
                  </span>
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Button
        variant="secondary"
        block
        onClick={() => navigate(`/workspace/${workspaceId}/settings`)}
      >
        Назад
      </Button>
    </div>
  );
}
