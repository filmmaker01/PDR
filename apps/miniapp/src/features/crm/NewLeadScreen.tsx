import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@pdr/api-client';
import { LEAD_CHANNEL_SOURCES, damageTypeLabel, describeDamageSize, panelLabel } from '@pdr/shared';
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
import { api } from '@/shared/api';
import { createUploadTransport } from '@/shared/uploads';
import { formatPhoneRu } from '@/shared/format';
import { alertDialog, haptic } from '@/shared/telegram';
import { useClients } from './api';
import { DamageSheet } from './DamageSheet';
import {
  LEAD_CHANNEL_OPTIONS,
  type ClientListItem,
  type DamageDraft,
  type LeadChannel,
} from './types';

/**
 * Новое обращение.
 *
 * Один экран на весь вход: кто обратился, на какой машине, откуда пришёл,
 * фотографии, отмеченные на схеме детали и комментарий. Всё уходит одним
 * запросом — и потом переезжает в заказ без повторного заполнения.
 */
export function NewLeadScreen() {
  const { workspaceId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [selectedClient, setSelectedClient] = useState<ClientListItem | null>(null);
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactExtra, setContactExtra] = useState('');

  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [plate, setPlate] = useState('');

  const [channel, setChannel] = useState<LeadChannel | ''>('');
  const [comment, setComment] = useState('');
  const [nextContactAt, setNextContactAt] = useState('');

  const [damages, setDamages] = useState<DamageDraft[]>([]);
  const [panelCode, setPanelCode] = useState<string | null>(null);
  const [damageSheet, setDamageSheet] = useState(false);

  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const clients = useClients(workspaceId, search);

  // Файлы загружаются сразу, а привязываются к обращению при сохранении:
  // клиент показывает фотографии, пока мастер ещё заполняет форму.
  const [fileIds, setFileIds] = useState<string[]>([]);
  const uploads = useUploadQueue({
    transport: createUploadTransport({ scope: 'order_photo', workspaceId }),
    onUploaded: async (fileId) => {
      setFileIds((current) => [...current, fileId]);
    },
  });

  const counts = damages.reduce<Record<string, number>>((acc, damage) => {
    acc[damage.panelCode] = (acc[damage.panelCode] ?? 0) + 1;
    return acc;
  }, {});

  const create = useMutation({
    mutationFn: () =>
      api.post<{ id: string; number: number; photos: { attached: number; failed: unknown[] } }>(
        `/workspaces/${workspaceId}/leads`,
        {
          ...(selectedClient
            ? { clientId: selectedClient.id }
            : {
                contactName: contactName.trim() || null,
                contactPhone: contactPhone.trim() || null,
                contactExtra: contactExtra.trim() || null,
              }),
          ...(vehicleId
            ? { vehicleId }
            : {
                vehicleMake: make.trim() || null,
                vehicleModel: model.trim() || null,
                vehiclePlate: plate.trim() || null,
              }),
          ...(channel ? { channel, source: LEAD_CHANNEL_SOURCES[channel] } : {}),
          comment: comment.trim() || null,
          nextContactAt: nextContactAt ? new Date(nextContactAt).toISOString() : null,
          damages,
          photos: fileIds.map((fileId) => ({ fileId, category: 'before' })),
        },
        // Ключ идемпотентности один на экран: повтор после обрыва сети
        // не создаёт второе обращение.
        { idempotencyKey },
      ),
    onSuccess: async (lead) => {
      haptic('success');
      await queryClient.invalidateQueries({ queryKey: ['crm'] });
      if (lead.photos.failed.length > 0) {
        await alertDialog(
          `Обращение создано, но ${lead.photos.failed.length} фото не прикрепилось. Добавьте их из карточки.`,
        );
      }
      navigate(`/workspace/${workspaceId}/leads/${lead.id}`, { replace: true });
    },
    onError: async (e) => {
      haptic('error');
      await alertDialog(e instanceof ApiError ? e.message : 'Не удалось создать обращение');
    },
  });

  const contactReady =
    selectedClient !== null ||
    contactName.trim().length > 0 ||
    contactPhone.trim().length > 0 ||
    contactExtra.trim().length > 0;

  return (
    <div className="pdr-stack">
      <h1 className="pdr-title">Новое обращение</h1>

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
            <Field label="Найти клиента" hint="Если он уже есть в базе">
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
                {clients.data!.items.slice(0, 6).map((client) => (
                  <ListItem
                    key={client.id}
                    title={client.name}
                    subtitle={client.phone ? formatPhoneRu(client.phone) : ''}
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
              <Field label="Имя">
                <Input
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  placeholder="Иван"
                />
              </Field>
              <Field label="Телефон">
                <Input
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                  placeholder="+7 999 123-45-67"
                  inputMode="tel"
                />
              </Field>
              <Field label="Другой контакт" hint="Ник в мессенджере или ссылка">
                <Input
                  value={contactExtra}
                  onChange={(e) => setContactExtra(e.target.value)}
                  placeholder="@ivan"
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

      <h2 className="pdr-subtitle">Откуда обращение</h2>
      <Card>
        <div className="pdr-chips">
          {LEAD_CHANNEL_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`pdr-chip${channel === option.value ? ' pdr-chip--active' : ''}`}
              onClick={() => setChannel(channel === option.value ? '' : option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
        {channel ? (
          <div className="pdr-hint" style={{ marginTop: 6 }}>
            Источник: {LEAD_CHANNEL_SOURCES[channel] === 'online' ? 'онлайн' : 'лично'}
          </div>
        ) : null}
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
          hint="Снимите повреждение камерой или выберите из галереи фото, которое прислал клиент."
        />
      </Card>

      <h2 className="pdr-subtitle">Повреждения</h2>
      <Card>
        <CarScheme
          counts={counts}
          onSelect={(code) => {
            setPanelCode(code);
            setDamageSheet(true);
          }}
          hint="Отметьте повреждённые детали — они перейдут в оценку и в заказ."
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
                  // Показывается измеренный размер, а не тарифная зона:
                  // 300×300 см не должно превращаться в «100×100».
                  describeDamageSize(damage.widthMm, damage.heightMm, damage.sizeClass).actual,
                  damage.quantity && damage.quantity > 1 ? `${damage.quantity} шт` : null,
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

      <h2 className="pdr-subtitle">Комментарий</h2>
      <Card>
        <div className="pdr-stack">
          <Field label="Что сказал клиент">
            <Textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={3}
              placeholder="Град на капоте и крыше, хочет узнать цену"
            />
          </Field>
          <Field label="Когда связаться" hint="Необязательно: попадёт в список «пора звонить»">
            <Input
              type="datetime-local"
              value={nextContactAt}
              onChange={(e) => setNextContactAt(e.target.value)}
            />
          </Field>
        </div>
      </Card>

      {uploads.pending ? (
        <div className="pdr-hint">Идёт загрузка фотографий, не закрывайте приложение.</div>
      ) : null}

      <Button
        block
        disabled={!contactReady || uploads.pending}
        loading={create.isPending}
        onClick={() => create.mutate()}
      >
        Создать обращение
      </Button>
      <Button variant="secondary" block onClick={() => navigate(-1)}>
        Отмена
      </Button>

      {panelCode ? (
        <DamageSheet
          open={damageSheet}
          onClose={() => setDamageSheet(false)}
          workspaceId={workspaceId}
          parent={{ leadId: '' }}
          panelCode={panelCode}
          canEdit
          draftMode
          onDraftSave={(draft) => setDamages((current) => [...current, draft])}
        />
      ) : null}
    </div>
  );
}
