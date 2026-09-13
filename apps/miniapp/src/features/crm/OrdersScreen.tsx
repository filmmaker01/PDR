import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Badge, Button, Card, Chips, EmptyState, Input, ListItem, SkeletonList } from '@pdr/ui';
import { formatMinor } from '@/shared/format';
import { useOrders } from './api';
import { STATUS_TONES, type OrderStatus } from './types';

const STATUS_FILTERS: { value: OrderStatus; label: string }[] = [
  { value: 'new', label: 'Новые' },
  { value: 'pending_approval', label: 'Согласование' },
  { value: 'scheduled', label: 'Запланированы' },
  { value: 'in_progress', label: 'В работе' },
  { value: 'ready', label: 'Готовы' },
  { value: 'delivered', label: 'Выданы' },
  { value: 'cancelled', label: 'Отменены' },
];

export function OrdersScreen() {
  const { workspaceId = '' } = useParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<OrderStatus | null>(null);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');

  const orders = useOrders(workspaceId, {
    status: status ? [status] : undefined,
    q: query || undefined,
  });

  return (
    <div className="pdr-stack">
      <Card>
        <div className="pdr-row">
          <Input
            className="pdr-grow"
            placeholder="Номер, клиент, телефон или номер авто"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') setQuery(search);
            }}
          />
          <Button size="sm" onClick={() => setQuery(search)}>
            Найти
          </Button>
        </div>
      </Card>

      <Chips options={STATUS_FILTERS} value={status} onChange={setStatus} />

      <Button block onClick={() => navigate(`/workspace/${workspaceId}/orders/new`)}>
        + Новый заказ
      </Button>

      {orders.isLoading ? (
        <SkeletonList rows={5} />
      ) : (orders.data?.items.length ?? 0) === 0 ? (
        <EmptyState
          title={query || status ? 'Ничего не найдено' : 'Заказов пока нет'}
          description={
            query || status
              ? 'Попробуйте изменить запрос или снять фильтр.'
              : 'Создайте первый заказ — он появится здесь.'
          }
        />
      ) : (
        <Card flat>
          <div className="pdr-list">
            {orders.data!.items.map((order) => (
              <ListItem
                key={order.id}
                title={`№${order.number} · ${order.client.name}`}
                subtitle={[
                  order.vehicle
                    ? `${order.vehicle.make} ${order.vehicle.model}${order.vehicle.plate ? `, ${order.vehicle.plate}` : ''}`
                    : null,
                  order.title,
                  order.agreedTotalMinor !== null
                    ? `${formatMinor(order.paidMinor, order.currency)} из ${formatMinor(order.agreedTotalMinor, order.currency)}`
                    : 'смета не согласована',
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
