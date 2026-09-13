import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@pdr/api-client';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  ListItem,
  Sheet,
  SkeletonList,
} from '@pdr/ui';
import { api } from '@/shared/api';
import { formatMinor, formatPhoneRu } from '@/shared/format';
import { alertDialog, confirmDialog, haptic } from '@/shared/telegram';
import { useClient, useClients, useVehicle, useWorkspace } from './api';
import { STATUS_TONES } from './types';

export function ClientsScreen() {
  const { workspaceId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [sheet, setSheet] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');

  const clients = useClients(workspaceId, query);
  const workspace = useWorkspace(workspaceId);

  const create = useMutation({
    mutationFn: () =>
      api.post<{ id: string }>(`/workspaces/${workspaceId}/clients`, {
        name,
        phone: phone || null,
      }),
    onSuccess: async (client) => {
      setSheet(false);
      setName('');
      setPhone('');
      await queryClient.invalidateQueries({ queryKey: ['crm', 'clients'] });
      navigate(`/workspace/${workspaceId}/clients/${client.id}`);
    },
    onError: async (e) =>
      alertDialog(e instanceof ApiError ? e.message : 'Не удалось создать клиента'),
  });

  return (
    <div className="pdr-stack">
      <Card>
        <div className="pdr-row">
          <Input
            className="pdr-grow"
            placeholder="Имя, телефон или номер авто"
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

      {workspace.data?.access.active ? (
        <Button block onClick={() => setSheet(true)}>
          + Новый клиент
        </Button>
      ) : null}

      {clients.isLoading ? (
        <SkeletonList rows={5} />
      ) : (clients.data?.items.length ?? 0) === 0 ? (
        <EmptyState
          title={query ? 'Ничего не найдено' : 'Клиентов пока нет'}
          description={
            query ? 'Попробуйте другой запрос.' : 'Клиенты появляются вместе с заказами.'
          }
        />
      ) : (
        <Card flat>
          <div className="pdr-list">
            {clients.data!.items.map((client) => (
              <ListItem
                key={client.id}
                title={client.name}
                subtitle={[
                  client.phone ? formatPhoneRu(client.phone) : null,
                  client.vehicles
                    .map((v) => `${v.make} ${v.model}${v.plate ? ` ${v.plate}` : ''}`)
                    .join(', ') || null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                onClick={() => navigate(`/workspace/${workspaceId}/clients/${client.id}`)}
              />
            ))}
          </div>
        </Card>
      )}

      <Sheet open={sheet} onClose={() => setSheet(false)} title="Новый клиент">
        <div className="pdr-stack">
          <Field label="Имя">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Иван Петров"
            />
          </Field>
          <Field label="Телефон">
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+7 999 123-45-67"
              inputMode="tel"
            />
          </Field>
          <Button
            block
            disabled={name.trim().length === 0}
            loading={create.isPending}
            onClick={() => create.mutate()}
          >
            Создать
          </Button>
        </div>
      </Sheet>
    </div>
  );
}

export function ClientScreen() {
  const { workspaceId = '', clientId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const client = useClient(workspaceId, clientId);
  const workspace = useWorkspace(workspaceId);

  const canManage = workspace.data?.permissions.includes('clients.manage') ?? false;

  const anonymize = useMutation({
    mutationFn: () => api.post(`/workspaces/${workspaceId}/clients/${clientId}/anonymize`),
    onSuccess: async () => {
      haptic('success');
      await queryClient.invalidateQueries({ queryKey: ['crm'] });
    },
    onError: async (e) =>
      alertDialog(e instanceof ApiError ? e.message : 'Не удалось удалить данные клиента'),
  });

  if (client.isLoading) return <SkeletonList rows={4} />;
  if (client.isError) {
    return <EmptyState title="Клиент недоступен" description="Возможно, он в другой мастерской." />;
  }

  const data = client.data!;

  return (
    <div className="pdr-stack">
      <Card>
        <div style={{ fontSize: 18, fontWeight: 700 }}>{data.name}</div>
        {data.phone ? (
          <a href={`tel:${data.phone}`} style={{ color: 'var(--pdr-link)' }}>
            {formatPhoneRu(data.phone)}
          </a>
        ) : null}
        {data.telegramUsername ? (
          <div>
            <a
              href={`https://t.me/${data.telegramUsername}`}
              target="_blank"
              rel="noreferrer"
              style={{ color: 'var(--pdr-link)' }}
            >
              @{data.telegramUsername}
            </a>
          </div>
        ) : null}
        {data.debtMinor > 0 ? (
          <div style={{ marginTop: 8 }}>
            <Badge tone="danger">Долг {formatMinor(data.debtMinor, data.currency)}</Badge>
          </div>
        ) : null}
        {data.notes ? (
          <div className="pdr-hint" style={{ marginTop: 8, whiteSpace: 'pre-wrap' }}>
            {data.notes}
          </div>
        ) : null}
      </Card>

      <h2 className="pdr-subtitle">Автомобили</h2>
      {data.vehicles.length === 0 ? (
        <EmptyState title="Автомобилей пока нет" />
      ) : (
        <Card flat>
          <div className="pdr-list">
            {data.vehicles.map((vehicle) => (
              <ListItem
                key={vehicle.id}
                title={`${vehicle.make} ${vehicle.model}`}
                subtitle={[vehicle.plate, vehicle.year, vehicle.color].filter(Boolean).join(' · ')}
                onClick={() => navigate(`/workspace/${workspaceId}/vehicles/${vehicle.id}`)}
              />
            ))}
          </div>
        </Card>
      )}

      <h2 className="pdr-subtitle">История обращений</h2>
      {data.orders.length === 0 ? (
        <EmptyState title="Заказов пока нет" />
      ) : (
        <Card flat>
          <div className="pdr-list">
            {data.orders.map((order) => (
              <ListItem
                key={order.id}
                title={`№${order.number} · ${order.title ?? 'без описания'}`}
                subtitle={[
                  order.vehicle ? `${order.vehicle.make} ${order.vehicle.model}` : null,
                  order.agreedTotalMinor !== null
                    ? formatMinor(order.agreedTotalMinor, data.currency)
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                right={<Badge tone={STATUS_TONES[order.status]}>{order.status}</Badge>}
                onClick={() => navigate(`/workspace/${workspaceId}/orders/${order.id}`)}
              />
            ))}
          </div>
        </Card>
      )}

      <Button
        block
        onClick={() => navigate(`/workspace/${workspaceId}/orders/new?clientId=${clientId}`)}
      >
        Новый заказ этому клиенту
      </Button>

      {canManage && !data.anonymizedAt ? (
        <Button
          variant="danger"
          block
          loading={anonymize.isPending}
          onClick={async () => {
            const confirmed = await confirmDialog(
              'Удалить персональные данные клиента? Имя, телефон, номер автомобиля и заметки будут стёрты. Заказы и оплаты останутся.',
            );
            if (confirmed) anonymize.mutate();
          }}
        >
          Удалить персональные данные
        </Button>
      ) : null}

      {data.anonymizedAt ? (
        <div className="pdr-hint">
          Персональные данные этого клиента удалены по запросу. История заказов сохранена как
          финансовая запись.
        </div>
      ) : null}
    </div>
  );
}

export function VehicleScreen() {
  const { workspaceId = '', vehicleId = '' } = useParams();
  const navigate = useNavigate();
  const vehicle = useVehicle(workspaceId, vehicleId);

  if (vehicle.isLoading) return <SkeletonList rows={3} />;
  if (vehicle.isError) {
    return <EmptyState title="Автомобиль недоступен" />;
  }

  const data = vehicle.data!;

  return (
    <div className="pdr-stack">
      <Card>
        <div style={{ fontSize: 18, fontWeight: 700 }}>
          {data.make} {data.model}
        </div>
        <div className="pdr-hint">
          {[data.plate, data.year, data.color, data.bodyType].filter(Boolean).join(' · ')}
        </div>
        {data.vin ? <div className="pdr-hint">VIN: {data.vin}</div> : null}
        <div style={{ marginTop: 8 }}>
          <button
            type="button"
            style={{ all: 'unset', cursor: 'pointer', color: 'var(--pdr-link)' }}
            onClick={() => navigate(`/workspace/${workspaceId}/clients/${data.client.id}`)}
          >
            Владелец: {data.client.name}
          </button>
        </div>
      </Card>

      <h2 className="pdr-subtitle">История ремонтов</h2>
      {data.orders.length === 0 ? (
        <EmptyState title="Ремонтов пока не было" />
      ) : (
        <Card flat>
          <div className="pdr-list">
            {data.orders.map((order) => (
              <ListItem
                key={order.id}
                title={`№${order.number} · ${order.title ?? 'без описания'}`}
                subtitle={
                  order.agreedTotalMinor !== null
                    ? formatMinor(order.agreedTotalMinor, order.currency)
                    : 'смета не согласована'
                }
                right={<Badge tone={STATUS_TONES[order.status]}>{order.status}</Badge>}
                onClick={() => navigate(`/workspace/${workspaceId}/orders/${order.id}`)}
              />
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
