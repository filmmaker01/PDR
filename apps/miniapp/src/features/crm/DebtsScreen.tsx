import { useNavigate, useParams } from 'react-router-dom';
import { Badge, Card, EmptyState, ListItem, SkeletonList } from '@pdr/ui';
import { formatDateTime, formatMinor, formatPhoneRu } from '@/shared/format';
import { useDebts } from './api';
import { ScreenError } from './ScreenError';

export function DebtsScreen() {
  const { workspaceId = '' } = useParams();
  const navigate = useNavigate();
  const debts = useDebts(workspaceId);

  if (debts.isError) {
    return (
      <ScreenError
        error={debts.error}
        onRetry={() => void debts.refetch()}
        backTo={`/workspace/${workspaceId}/settings`}
      />
    );
  }
  if (debts.isLoading) return <SkeletonList rows={4} />;

  const items = debts.data ?? [];
  const total = items.reduce((sum, order) => sum + order.debtMinor, 0);

  return (
    <div className="pdr-stack">
      <h1 className="pdr-title">Задолженность</h1>

      {items.length === 0 ? (
        <EmptyState title="Долгов нет" description="Все согласованные заказы оплачены полностью." />
      ) : (
        <>
          <Card>
            <div className="pdr-row">
              <span className="pdr-grow pdr-hint">Всего к получению</span>
              <span style={{ fontSize: 20, fontWeight: 700 }}>
                {formatMinor(total, items[0]!.currency)}
              </span>
            </div>
          </Card>

          <Card flat>
            <div className="pdr-list">
              {items.map((order) => (
                <ListItem
                  key={order.id}
                  title={`№${order.number} · ${order.clientName}`}
                  subtitle={[
                    order.clientPhone ? formatPhoneRu(order.clientPhone) : null,
                    `оплачено ${formatMinor(order.paidMinor, order.currency)} из ${formatMinor(order.agreedTotalMinor, order.currency)}`,
                    order.deliveredAt ? `выдан ${formatDateTime(order.deliveredAt)}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  right={
                    <Badge tone="danger">{formatMinor(order.debtMinor, order.currency)}</Badge>
                  }
                  onClick={() => navigate(`/workspace/${workspaceId}/orders/${order.id}`)}
                />
              ))}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
