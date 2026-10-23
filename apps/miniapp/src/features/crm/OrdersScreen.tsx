import { useNavigate, useParams } from 'react-router-dom';
import clsx from 'clsx';
import { Badge, Button, Card, EmptyState, Input, ListItem, SkeletonList } from '@pdr/ui';
import { formatMinor } from '@/shared/format';
import { setStickyValue, useStickyState } from '@/shared/navigation';
import { useMembers, useOrderCounts, useOrders } from './api';
import { ScreenError } from './ScreenError';
import {
  ACTIVE_ORDER_STATUSES,
  CLOSED_ORDER_STATUSES,
  ORDER_STATUS_TABS,
  STATUS_TONES,
  type OrderStatus,
} from './types';

/** Вкладка списка: все незакрытые заказы или один статус. */
export type OrdersTab = 'active' | OrderStatus;

function ordersTabKey(workspaceId: string): string {
  return `${workspaceId}.orders.tab`;
}

/**
 * Подготовить список заказов к открытию на нужной вкладке — с главной или из
 * карточки заказа. Поиск сбрасывается: иначе он перекрыл бы выбранную вкладку.
 */
export function openOrdersTab(workspaceId: string, tab: OrdersTab): void {
  setStickyValue(ordersTabKey(workspaceId), tab);
  setStickyValue(`${workspaceId}.orders.search`, '');
  setStickyValue(`${workspaceId}.orders.query`, '');
}

/**
 * Заказы мастерской по статусам.
 *
 * По умолчанию — «Активные»: все незакрытые заказы, какой бы ни был статус.
 * Так заказ не «пропадает», когда его перевели, например, в «На согласовании»:
 * он остаётся в общей вкладке и одновременно виден во вкладке своего статуса
 * со счётчиком. Выданные и отменённые — отдельно, чтобы не мешать работе.
 *
 * Поиск идёт по всем статусам сразу: кого ищут по телефону или номеру
 * машины, того не должна прятать выбранная вкладка.
 */
export function OrdersScreen() {
  const { workspaceId = '' } = useParams();
  const navigate = useNavigate();
  const [tab, setTab] = useStickyState<OrdersTab>(ordersTabKey(workspaceId), 'active');
  const [assigneeMemberId, setAssigneeMemberId] = useStickyState<string | null>(
    `${workspaceId}.orders.assignee`,
    null,
  );
  const [search, setSearch] = useStickyState(`${workspaceId}.orders.search`, '');
  const [query, setQuery] = useStickyState(`${workspaceId}.orders.query`, '');

  const searching = query.trim().length > 0;
  const members = useMembers(workspaceId);
  const counts = useOrderCounts(workspaceId, {
    q: query || undefined,
    assigneeMemberId: assigneeMemberId ?? undefined,
  });
  const orders = useOrders(workspaceId, {
    status: searching ? undefined : tab === 'active' ? ACTIVE_ORDER_STATUSES : [tab],
    assigneeMemberId: assigneeMemberId ?? undefined,
    q: query || undefined,
  });

  if (orders.isError) {
    return <ScreenError error={orders.error} onRetry={() => void orders.refetch()} />;
  }

  const count = (status: OrderStatus): number => counts.data?.counts[status] ?? 0;
  const activeTotal = ACTIVE_ORDER_STATUSES.reduce((sum, status) => sum + count(status), 0);
  const label = (text: string, n: number): string => (counts.data ? `${text} · ${n}` : text);

  const resetSearch = (): void => {
    setSearch('');
    setQuery('');
  };

  const tabChip = (value: OrdersTab, text: string, n: number) => (
    <button
      key={value}
      type="button"
      className={clsx('pdr-chip', !searching && tab === value && 'pdr-chip--active')}
      onClick={() => {
        setTab(value);
        // Вкладку выбирают, чтобы посмотреть статус, а не результат поиска.
        if (searching) resetSearch();
      }}
    >
      {label(text, n)}
    </button>
  );

  const items = orders.data?.items ?? [];

  return (
    <div className="pdr-stack">
      <Card>
        <div className="pdr-row">
          <Input
            className="pdr-grow"
            placeholder="Номер, клиент, телефон или машина"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') setQuery(search);
            }}
          />
          {searching ? (
            <Button size="sm" variant="secondary" onClick={resetSearch} aria-label="Сбросить поиск">
              ×
            </Button>
          ) : null}
          <Button size="sm" onClick={() => setQuery(search)}>
            Найти
          </Button>
        </div>
      </Card>

      <div className="pdr-chips pdr-chips--wrap">
        {tabChip('active', 'Активные', activeTotal)}
        {ACTIVE_ORDER_STATUSES.map((status) =>
          tabChip(status, ORDER_STATUS_TABS[status], count(status)),
        )}
      </div>
      <div className="pdr-chips pdr-chips--wrap">
        <span className="pdr-hint" style={{ alignSelf: 'center' }}>
          Закрытые:
        </span>
        {CLOSED_ORDER_STATUSES.map((status) =>
          tabChip(status, ORDER_STATUS_TABS[status], count(status)),
        )}
      </div>

      {/* Что именно показано — словами: иначе включённый фильтр выглядит
          так, будто заказ исчез. */}
      {searching ? (
        <div className="pdr-row">
          <span className="pdr-hint pdr-grow">
            Поиск «{query}» по всем статусам, включая закрытые
          </span>
          <Button size="sm" variant="ghost" onClick={resetSearch}>
            Сбросить
          </Button>
        </div>
      ) : tab !== 'active' ? (
        <div className="pdr-row">
          <span className="pdr-hint pdr-grow">
            Показаны только «{ORDER_STATUS_TABS[tab]}». Всего активных: {activeTotal}
          </span>
          <Button size="sm" variant="ghost" onClick={() => setTab('active')}>
            Все активные
          </Button>
        </div>
      ) : null}

      {(members.data?.length ?? 0) > 1 ? (
        <div className="pdr-chips">
          <button
            type="button"
            className={`pdr-chip${assigneeMemberId === null ? ' pdr-chip--active' : ''}`}
            onClick={() => setAssigneeMemberId(null)}
          >
            Все исполнители
          </button>
          {members
            .data!.filter((member) => member.isActive)
            .map((member) => (
              <button
                key={member.id}
                type="button"
                className={`pdr-chip${assigneeMemberId === member.id ? ' pdr-chip--active' : ''}`}
                onClick={() =>
                  setAssigneeMemberId(assigneeMemberId === member.id ? null : member.id)
                }
              >
                {member.name}
              </button>
            ))}
        </div>
      ) : null}

      <Button block onClick={() => navigate(`/workspace/${workspaceId}/orders/new`)}>
        + Новый заказ
      </Button>

      {orders.isLoading ? (
        <SkeletonList rows={5} />
      ) : items.length === 0 ? (
        <div className="pdr-stack">
          <EmptyState
            title={
              searching
                ? 'Ничего не найдено'
                : tab === 'active'
                  ? 'Активных заказов нет'
                  : `«${ORDER_STATUS_TABS[tab]}» — пусто`
            }
            description={
              searching
                ? 'Проверьте номер, телефон или имя клиента.'
                : tab === 'active'
                  ? 'Создайте заказ — он появится здесь.'
                  : 'В этом статусе заказов нет. Остальные — во вкладке «Активные».'
            }
          />
          {searching ? (
            <Button variant="secondary" block onClick={resetSearch}>
              Сбросить поиск
            </Button>
          ) : tab !== 'active' ? (
            <Button variant="secondary" block onClick={() => setTab('active')}>
              Показать все активные
            </Button>
          ) : null}
        </div>
      ) : (
        <Card flat>
          <div className="pdr-list">
            {items.map((order) => (
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
