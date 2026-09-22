import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@pdr/api-client';
import {
  Badge,
  Button,
  CarScheme,
  Card,
  Field,
  Input,
  ListItem,
  MediaUploader,
  Textarea,
  useUploadQueue,
} from '@pdr/ui';
import { damageTypeLabel, panelLabel, sizeClassLabel } from '@pdr/shared';
import { api } from '@/shared/api';
import { createUploadTransport } from '@/shared/uploads';
import { formatPhoneRu } from '@/shared/format';
import { alertDialog, confirmDialog, haptic } from '@/shared/telegram';
import { useClients, useMembers, useWorkspace } from './api';
import { DamageSheet } from './DamageSheet';
import {
  APPOINTMENT_KIND_OPTIONS,
  type AppointmentKind,
  type ClientListItem,
  type DamageDraft,
} from './types';

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

  const [damages, setDamages] = useState<DamageDraft[]>([]);
  const [panelCode, setPanelCode] = useState<string | null>(null);
  const [damageSheet, setDamageSheet] = useState(false);
  const [fileIds, setFileIds] = useState<string[]>([]);

  const [withAppointment, setWithAppointment] = useState(false);
  const [day, setDay] = useState(() => new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState('10:00');
  const [durationMin, setDurationMin] = useState(60);
  const [kind, setKind] = useState<AppointmentKind>('inspection');

  const clients = useClients(workspaceId, search);

  // Файлы уезжают в хранилище сразу, а к заказу привязываются после его
  // создания: снять повреждение важно в момент осмотра, а не после формы.
  const uploads = useUploadQueue({
    transport: createUploadTransport({ scope: 'order_photo', workspaceId }),
    onUploaded: async (fileId) => {
      setFileIds((current) => [...current, fileId]);
    },
  });

  const damageCounts = damages.reduce<Record<string, number>>((acc, damage) => {
    acc[damage.panelCode] = (acc[damage.panelCode] ?? 0) + 1;
    return acc;
  }, {});
  const members = useMembers(workspaceId);
  const workspace = useWorkspace(workspaceId);
  const canAssign = workspace.data?.permissions.includes('orders.assign') ?? false;

  const create = useMutation({
    mutationFn: (options: { allowOverlap?: boolean } = {}) =>
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
          ...(withAppointment
            ? {
                appointment: {
                  startsAtLocal: `${day}T${time}`,
                  durationMin,
                  kind,
                  ...(options.allowOverlap ? { allowOverlap: true } : {}),
                },
              }
            : {}),
        },
        // Ключ идемпотентности один на экран: повтор после обрыва сети
        // не создаёт второй заказ.
        { idempotencyKey },
      ),
    onSuccess: async (order) => {
      haptic('success');

      // Повреждения и снимки привязываются к уже созданному заказу: отдельный
      // сбой на фотографии не должен отменять сам заказ.
      for (const damage of damages) {
        await api
          .post(`/workspaces/${workspaceId}/orders/${order.id}/damages`, damage)
          .catch(() => undefined);
      }
      for (const fileId of fileIds) {
        await api
          .post(`/workspaces/${workspaceId}/orders/${order.id}/photos`, {
            fileId,
            category: 'before',
          })
          .catch(() => undefined);
      }

      await queryClient.invalidateQueries({ queryKey: ['crm'] });
      navigate(`/workspace/${workspaceId}/orders/${order.id}`, { replace: true });
    },
    onError: async (e) => {
      haptic('error');
      if (e instanceof ApiError && e.code === 'overlap') {
        const details = e.details as { canOverride?: boolean } | undefined;
        if (details?.canOverride) {
          const force = await confirmDialog(
            'В это время у исполнителя уже есть запись. Записать всё равно?',
          );
          if (force) create.mutate({ allowOverlap: true });
          return;
        }
        await alertDialog('В это время у исполнителя уже есть запись. Выберите другое время.');
        return;
      }
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

      <h2 className="pdr-subtitle">Фотографии</h2>
      <Card>
        <MediaUploader
          items={uploads.items}
          onAdd={uploads.add}
          onRetry={uploads.retry}
          onRemove={uploads.remove}
          accept="image/*"
          capture
          cameraLabel="📷 Снять фото"
          galleryLabel="🖼 Выбрать из галереи"
          hint="Снимите повреждение камерой или выберите готовую фотографию из галереи."
        />
      </Card>

      <h2 className="pdr-subtitle">Повреждения</h2>
      <Card>
        <CarScheme
          counts={damageCounts}
          onSelect={(code) => {
            setPanelCode(code);
            setDamageSheet(true);
          }}
          hint="Отметьте повреждённые детали — их можно будет оценить сразу после создания заказа."
        />
      </Card>

      {damages.length > 0 ? (
        <Card flat>
          <div className="pdr-list">
            {damages.map((damage, index) => (
              <ListItem
                key={index}
                title={panelLabel(damage.panelCode) ?? damage.panelCode}
                subtitle={[
                  damageTypeLabel(damage.damageType),
                  damage.sizeClass ? `размер ${sizeClassLabel(damage.sizeClass)}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                right={<Badge tone="muted">убрать</Badge>}
                onClick={() => setDamages((current) => current.filter((_, i) => i !== index))}
              />
            ))}
          </div>
        </Card>
      ) : null}

      <h2 className="pdr-subtitle">Запись в календарь</h2>
      <Card>
        <div className="pdr-stack">
          <label className="pdr-row" style={{ cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={withAppointment}
              onChange={(e) => setWithAppointment(e.target.checked)}
            />
            <span className="pdr-grow">Записать клиента на приём</span>
          </label>

          {withAppointment ? (
            <>
              <div className="pdr-row">
                <Field label="Дата">
                  <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
                </Field>
                <Field label="Время">
                  <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
                </Field>
              </div>
              <Field label="Длительность">
                <select
                  className="pdr-select"
                  value={durationMin}
                  onChange={(e) => setDurationMin(Number(e.target.value))}
                >
                  {[30, 60, 90, 120, 180, 240].map((value) => (
                    <option key={value} value={value}>
                      {value < 60 ? `${value} мин` : `${value / 60} ч`}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Тип">
                <div className="pdr-chips">
                  {APPOINTMENT_KIND_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={`pdr-chip${kind === option.value ? ' pdr-chip--active' : ''}`}
                      onClick={() => setKind(option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </Field>
            </>
          ) : null}
        </div>
      </Card>

      {uploads.pending ? (
        <div className="pdr-hint">Идёт загрузка фотографий, не закрывайте приложение.</div>
      ) : null}

      <Button
        block
        disabled={!clientReady || uploads.pending || (withAppointment && (!day || !time))}
        loading={create.isPending}
        onClick={() => create.mutate({})}
      >
        Создать заказ
      </Button>
      <Button variant="secondary" block onClick={() => navigate(-1)}>
        Отмена
      </Button>

      {panelCode ? (
        <DamageSheet
          open={damageSheet}
          onClose={() => setDamageSheet(false)}
          workspaceId={workspaceId}
          parent={{ orderId: '' }}
          panelCode={panelCode}
          canEdit
          draftMode
          onDraftSave={(draft) => setDamages((current) => [...current, draft])}
        />
      ) : null}
    </div>
  );
}
