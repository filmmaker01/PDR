import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@pdr/api-client';
import { Button, Card, Field, Input, ListItem, Textarea } from '@pdr/ui';
import { api } from '@/shared/api';
import { formatPhoneRu } from '@/shared/format';
import { alertDialog, haptic } from '@/shared/telegram';
import { useClients, useMembers, useWorkspace } from './api';
import type { ClientListItem } from './types';

/** Создание заказа: клиент, автомобиль и заказ одной операцией. */
export function NewOrderScreen() {
  const { workspaceId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [selectedClient, setSelectedClient] = useState<ClientListItem | null>(null);
  const [newClientName, setNewClientName] = useState('');
  const [newClientPhone, setNewClientPhone] = useState('');

  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [plate, setPlate] = useState('');

  const [title, setTitle] = useState('');
  const [damageSummary, setDamageSummary] = useState('');
  const [assigneeMemberId, setAssigneeMemberId] = useState<string>('');
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const clients = useClients(workspaceId, search);
  const members = useMembers(workspaceId);
  const workspace = useWorkspace(workspaceId);
  const canAssign = workspace.data?.permissions.includes('orders.assign') ?? false;

  const create = useMutation({
    mutationFn: () =>
      api.post<{ id: string; number: number }>(
        `/workspaces/${workspaceId}/orders`,
        {
          ...(selectedClient
            ? { clientId: selectedClient.id }
            : { newClient: { name: newClientName.trim(), phone: newClientPhone || null } }),
          ...(vehicleId
            ? { vehicleId }
            : make.trim() && model.trim()
              ? { newVehicle: { make: make.trim(), model: model.trim(), plate: plate || null } }
              : {}),
          title: title || null,
          damageSummary: damageSummary || null,
          ...(assigneeMemberId ? { assigneeMemberId } : {}),
        },
        { idempotencyKey },
      ),
    onSuccess: async (order) => {
      haptic('success');
      await queryClient.invalidateQueries({ queryKey: ['crm'] });
      navigate(`/workspace/${workspaceId}/orders/${order.id}`, { replace: true });
    },
    onError: async (e) => {
      haptic('error');
      await alertDialog(e instanceof ApiError ? e.message : 'Не удалось создать заказ');
    },
  });

  const clientReady = selectedClient !== null || newClientName.trim().length > 0;

  return (
    <div className="pdr-stack">
      <h2 className="pdr-subtitle">Клиент</h2>

      {selectedClient ? (
        <Card>
          <div className="pdr-row">
            <span className="pdr-grow">
              <span style={{ display: 'block', fontWeight: 600 }}>{selectedClient.name}</span>
              {selectedClient.phone ? (
                <span className="pdr-hint">{formatPhoneRu(selectedClient.phone)}</span>
              ) : null}
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setSelectedClient(null);
                setVehicleId(null);
              }}
            >
              Сменить
            </Button>
          </div>
        </Card>
      ) : (
        <>
          <Card>
            <Field label="Найти клиента" hint="По имени, телефону или номеру автомобиля">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Иван или 9991234567"
              />
            </Field>
          </Card>

          {search.length >= 2 && (clients.data?.items.length ?? 0) > 0 ? (
            <Card flat>
              <div className="pdr-list">
                {clients.data!.items.slice(0, 8).map((client) => (
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
                    onClick={() => {
                      setSelectedClient(client);
                      setSearch('');
                    }}
                  />
                ))}
              </div>
            </Card>
          ) : null}

          <Card>
            <div className="pdr-stack">
              <div style={{ fontWeight: 600 }}>Новый клиент</div>
              <Field label="Имя">
                <Input
                  value={newClientName}
                  onChange={(e) => setNewClientName(e.target.value)}
                  placeholder="Иван Петров"
                />
              </Field>
              <Field label="Телефон" hint="Необязательно, но помогает найти клиента позже">
                <Input
                  value={newClientPhone}
                  onChange={(e) => setNewClientPhone(e.target.value)}
                  placeholder="+7 999 123-45-67"
                  inputMode="tel"
                />
              </Field>
            </div>
          </Card>
        </>
      )}

      <h2 className="pdr-subtitle">Автомобиль</h2>

      {selectedClient && selectedClient.vehicles.length > 0 ? (
        <Card flat>
          <div className="pdr-list">
            {selectedClient.vehicles.map((vehicle) => (
              <ListItem
                key={vehicle.id}
                title={`${vehicle.make} ${vehicle.model}`}
                subtitle={[vehicle.plate, vehicle.year].filter(Boolean).join(' · ')}
                right={vehicleId === vehicle.id ? <span>✓</span> : null}
                onClick={() => setVehicleId(vehicleId === vehicle.id ? null : vehicle.id)}
              />
            ))}
          </div>
        </Card>
      ) : null}

      {!vehicleId ? (
        <Card>
          <div className="pdr-stack">
            <div className="pdr-row">
              <Field label="Марка">
                <Input
                  value={make}
                  onChange={(e) => setMake(e.target.value)}
                  placeholder="Toyota"
                />
              </Field>
              <Field label="Модель">
                <Input
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="Camry"
                />
              </Field>
            </div>
            <Field label="Госномер">
              <Input
                value={plate}
                onChange={(e) => setPlate(e.target.value)}
                placeholder="А123ВС77"
                autoCapitalize="characters"
              />
            </Field>
          </div>
        </Card>
      ) : null}

      <h2 className="pdr-subtitle">Работа</h2>
      <Card>
        <div className="pdr-stack">
          <Field label="Краткое описание">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Град на капоте и крыше"
            />
          </Field>
          <Field label="Повреждения" hint="Что осмотрели, что планируете делать">
            <Textarea
              value={damageSummary}
              onChange={(e) => setDamageSummary(e.target.value)}
              rows={3}
            />
          </Field>
          {canAssign ? (
            <Field label="Исполнитель" hint="По умолчанию — вы">
              <select
                className="pdr-select"
                value={assigneeMemberId}
                onChange={(e) => setAssigneeMemberId(e.target.value)}
              >
                <option value="">Я</option>
                {(members.data ?? [])
                  .filter((m) => m.isActive)
                  .map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name}
                    </option>
                  ))}
              </select>
            </Field>
          ) : null}
        </div>
      </Card>

      <Button
        block
        disabled={!clientReady}
        loading={create.isPending}
        onClick={() => create.mutate()}
      >
        Создать заказ
      </Button>
      <Button variant="secondary" block onClick={() => navigate(-1)}>
        Отмена
      </Button>
    </div>
  );
}
