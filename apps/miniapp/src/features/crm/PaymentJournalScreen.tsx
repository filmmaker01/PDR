import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Badge, Card, EmptyState, ListItem, SkeletonList, Button } from '@pdr/ui';
import { todayInZone, zonedTimeToUtc } from '@pdr/shared';
import { formatDateTime, formatMinor } from '@/shared/format';
import { usePaymentJournal, useWorkspace } from './api';

type Period = 'today' | 'week' | 'month';

const PERIODS: { value: Period; label: string; days: number }[] = [
  { value: 'today', label: 'Сегодня', days: 1 },
  { value: 'week', label: 'Неделя', days: 7 },
  { value: 'month', label: 'Месяц', days: 30 },
];

/** Журнал оплат мастерской: что и как получено за период. */
export function PaymentJournalScreen() {
  const { workspaceId = '' } = useParams();
  const navigate = useNavigate();
  const workspace = useWorkspace(workspaceId);
  const [period, setPeriod] = useState<Period>('week');

  const timezone = workspace.data?.timezone ?? 'Europe/Moscow';
  const range = useMemo(() => {
    const days = PERIODS.find((p) => p.value === period)?.days ?? 7;
    const today = todayInZone(timezone);
    const end = zonedTimeToUtc(`${today}T00:00:00`, timezone).getTime() + 86_400_000;
    return {
      from: new Date(end - days * 86_400_000).toISOString(),
      to: new Date(end).toISOString(),
    };
  }, [period, timezone]);

  const journal = usePaymentJournal(workspaceId, range);
  const currency = workspace.data?.currency ?? 'RUB';

  const received = (journal.data?.totals ?? [])
    .filter((total) => total.kind === 'payment')
    .reduce((sum, total) => sum + total.totalMinor, 0);
  const returned = (journal.data?.totals ?? [])
    .filter((total) => total.kind !== 'payment')
    .reduce((sum, total) => sum + total.totalMinor, 0);

  return (
    <div className="pdr-stack">
      <h1 className="pdr-title">Журнал оплат</h1>

      <div className="pdr-chips">
        {PERIODS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={`pdr-chip${period === option.value ? ' pdr-chip--active' : ''}`}
            onClick={() => setPeriod(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <Card>
        <div className="pdr-stack" style={{ gap: 6 }}>
          <div className="pdr-row">
            <span className="pdr-grow pdr-hint">Получено</span>
            <span style={{ fontWeight: 600 }}>{formatMinor(received, currency)}</span>
          </div>
          {returned > 0 ? (
            <div className="pdr-row">
              <span className="pdr-grow pdr-hint">Возвраты и корректировки</span>
              <span>−{formatMinor(returned, currency)}</span>
            </div>
          ) : null}
          {(journal.data?.totals ?? [])
            .filter((total) => total.kind === 'payment')
            .map((total) => (
              <div key={`${total.kind}-${total.method}`} className="pdr-row">
                <span className="pdr-grow pdr-hint">{total.method}</span>
                <span>{formatMinor(total.totalMinor, currency)}</span>
              </div>
            ))}
        </div>
      </Card>

      {journal.isLoading ? (
        <SkeletonList rows={4} />
      ) : (journal.data?.items.length ?? 0) === 0 ? (
        <EmptyState title="Оплат за период нет" />
      ) : (
        <Card flat>
          <div className="pdr-list">
            {journal.data!.items.map((entry) => (
              <ListItem
                key={entry.id}
                title={`№${entry.order.number} · ${entry.order.clientName}`}
                subtitle={[
                  entry.purposeLabel,
                  entry.methodLabel,
                  formatDateTime(entry.occurredAt),
                  entry.createdBy,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                right={
                  <Badge tone={entry.kind === 'payment' ? 'success' : 'warning'}>
                    {entry.kind === 'payment' ? '+' : '−'}
                    {formatMinor(entry.amountMinor, entry.currency)}
                  </Badge>
                }
                onClick={() => navigate(`/workspace/${workspaceId}/orders/${entry.order.id}`)}
              />
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
