import { useEffect, useMemo, useState } from 'react';
import { ApiError } from '@pdr/api-client';
import { Button, Sheet } from '@pdr/ui';
import { absoluteApiUrl, api } from '@/shared/api';
import { formatMinor, formatPhoneRu } from '@/shared/format';
import {
  MESSAGE_CHANNELS,
  copyText,
  type MessageChannel,
  type MessageRecipient,
  type OutgoingMessage,
} from '@/shared/messaging';
import { alertDialog, haptic } from '@/shared/telegram';
import { useDamages, useOrderPhotos } from './api';
import type { OrderListItem, OrderPhoto } from './types';

/** Обращение по имени: «Олег», а не «Олег Петрович Сидоров». */
function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

function availableChannels(): MessageChannel[] {
  return MESSAGE_CHANNELS.filter((channel) => channel.available());
}

/**
 * Телефон клиента с быстрыми действиями.
 *
 * «Позвонить» — обычная ссылка tel:, телефон сам предлагает звонок.
 * «Написать» — выбор канала: мессенджер клиента угадывать не нужно.
 */
export function ClientPhoneActions({
  recipient,
  workspaceName,
}: {
  recipient: MessageRecipient;
  workspaceName: string;
}) {
  const [writeOpen, setWriteOpen] = useState(false);
  if (!recipient.phone) return null;

  return (
    <>
      <div className="pdr-stack" style={{ gap: 6 }}>
        <div style={{ fontWeight: 600 }}>{formatPhoneRu(recipient.phone)}</div>
        <div className="pdr-row" style={{ gap: 8 }}>
          <a className="pdr-btn pdr-btn--secondary pdr-btn--sm" href={`tel:${recipient.phone}`}>
            📞 Позвонить
          </a>
          <Button size="sm" variant="secondary" onClick={() => setWriteOpen(true)}>
            💬 Написать
          </Button>
        </div>
      </div>

      <WriteSheet
        open={writeOpen}
        onClose={() => setWriteOpen(false)}
        recipient={recipient}
        text={`${firstName(recipient.name)}, здравствуйте! Это ${workspaceName}.`}
      />
    </>
  );
}

function WriteSheet({
  open,
  onClose,
  recipient,
  text,
}: {
  open: boolean;
  onClose: () => void;
  recipient: MessageRecipient;
  text: string;
}) {
  const channels = availableChannels();

  return (
    <Sheet open={open} onClose={onClose} title="Написать клиенту">
      <div className="pdr-stack">
        <div className="pdr-hint">
          Откроется выбранный мессенджер с готовым приветствием — отправляете вы сами.
          {recipient.telegramUsername
            ? ''
            : ' В Telegram откроется выбор чата: личный чат по одному номеру открыть нельзя.'}
        </div>
        {channels.map((channel) => (
          <Button
            key={channel.id}
            variant="secondary"
            block
            onClick={async () => {
              try {
                await channel.open({ text }, recipient);
                onClose();
              } catch {
                await alertDialog(`Не удалось открыть ${channel.label}`);
              }
            }}
          >
            {channel.icon} {channel.label}
          </Button>
        ))}
        {recipient.phone ? (
          <Button
            variant="secondary"
            block
            onClick={async () => {
              const copied = await copyText(recipient.phone!);
              haptic(copied ? 'success' : 'error');
              await alertDialog(copied ? 'Номер скопирован' : 'Не удалось скопировать номер');
              if (copied) onClose();
            }}
          >
            📋 Скопировать номер
          </Button>
        ) : null}
        <Button variant="ghost" block onClick={onClose}>
          Отмена
        </Button>
      </div>
    </Sheet>
  );
}

type Part = 'ready' | 'info' | 'photos' | 'work_order' | 'completion_act';

const DOCUMENTS: { part: 'work_order' | 'completion_act'; title: string }[] = [
  { part: 'work_order', title: 'Заказ-наряд' },
  { part: 'completion_act', title: 'Акт выполненных работ' },
];

/** Сколько снимков отправлять за раз: мессенджеры режут большие пачки. */
const MAX_PHOTOS = 10;

/**
 * «Отправить клиенту»: что отправить и куда.
 *
 * Текст собирается из заказа, документы уходят временной ссылкой (неделя)
 * или файлом, если устройство умеет делиться файлами. Мессенджер открывается
 * с готовым сообщением, а отправляет его мастер.
 */
export function SendToClientSheet({
  open,
  onClose,
  workspaceId,
  workspaceName,
  order,
}: {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
  workspaceName: string;
  order: OrderListItem;
}) {
  const photosQuery = useOrderPhotos(workspaceId, open ? order.id : '');
  const damagesQuery = useDamages(workspaceId, { orderId: order.id }, open);
  const [parts, setParts] = useState<Set<Part>>(new Set());
  const [sending, setSending] = useState<string | null>(null);
  /** Готовое сообщение: мессенджер открывается отдельным нажатием. */
  const [prepared, setPrepared] = useState<{
    channel: MessageChannel;
    message: OutgoingMessage;
  } | null>(null);

  useEffect(() => {
    if (!open) return;
    setParts(new Set(order.status === 'ready' ? ['ready', 'work_order'] : ['info']));
    setPrepared(null);
  }, [open, order.status]);

  // Клиенту важнее «после», чем процесс; если результата ещё нет — всё, что есть.
  const photos: OrderPhoto[] = useMemo(() => {
    const all = photosQuery.data?.items ?? [];
    const after = all.filter((photo) => photo.category === 'after');
    return (after.length > 0 ? after : all).slice(0, MAX_PHOTOS);
  }, [photosQuery.data]);

  const recipient: MessageRecipient = {
    name: order.client.name,
    phone: order.client.phone,
    telegramUsername: order.client.telegramUsername ?? null,
  };
  const vehicle = order.vehicle ? `${order.vehicle.make} ${order.vehicle.model}` : null;
  // Итог — по согласованной смете. Пока её нет — по отмеченным повреждениям
  // с их работами, как в карточке «Повреждения».
  const damagesTotal = (damagesQuery.data?.items ?? []).reduce(
    (sum, damage) => sum + (damage.priceMinor ?? 0) + damage.extrasMinor,
    0,
  );
  const total = order.agreedTotalMinor ?? (damagesTotal > 0 ? damagesTotal : null);

  const toggle = (part: Part): void => {
    setPrepared(null);
    setParts((current) => {
      const next = new Set(current);
      if (next.has(part)) next.delete(part);
      else next.add(part);
      return next;
    });
  };

  /** Текст без ссылок: они появятся при отправке. */
  const baseLines = (): string[] => {
    const lines: string[] = [];
    const name = firstName(order.client.name);
    if (parts.has('ready')) {
      lines.push(
        `${name}, ваш автомобиль${vehicle ? ` ${vehicle}` : ''} готов.` +
          (total !== null ? ` Итоговая стоимость: ${formatMinor(total, order.currency)}.` : ''),
      );
    }
    if (parts.has('info')) {
      const money =
        total !== null
          ? ` Стоимость: ${formatMinor(total, order.currency)}, оплачено ${formatMinor(
              order.paidMinor,
              order.currency,
            )}.`
          : '';
      lines.push(
        `${parts.has('ready') ? '' : `${name}, `}заказ №${order.number}` +
          `${vehicle ? ` · ${vehicle}` : ''}. Статус: ${order.statusLabel}.${money}`,
      );
    }
    return lines;
  };

  const preview = [
    ...baseLines(),
    ...DOCUMENTS.filter((doc) => parts.has(doc.part)).map((doc) => `${doc.title}: <ссылка>`),
  ].join('\n');

  /**
   * Подготовка: ссылки на документы, файлы. Это долго, а браузер разрешает
   * открыть мессенджер или системное «Поделиться» только сразу после нажатия —
   * поэтому открытие вынесено на отдельную кнопку.
   */
  const prepare = async (channel: MessageChannel): Promise<void> => {
    setSending(channel.id);
    setPrepared(null);
    try {
      const lines = baseLines();
      const files: File[] = [];
      const withFiles = channel.supportsFiles();

      for (const doc of DOCUMENTS.filter((item) => parts.has(item.part))) {
        if (withFiles) {
          const blob = await api.getBlob(
            `/workspaces/${workspaceId}/orders/${order.id}/documents/${doc.part}/pdf`,
          );
          files.push(
            new File([blob], `${doc.title} №${order.number}.pdf`, { type: 'application/pdf' }),
          );
        } else {
          const share = await api.post<{ token: string }>(
            `/workspaces/${workspaceId}/orders/${order.id}/documents/${doc.part}/share`,
          );
          lines.push(`${doc.title}: ${absoluteApiUrl(`/shared/documents/${share.token}`)}`);
        }
      }

      if (parts.has('photos') && withFiles) {
        for (const photo of photos) {
          const { url } = await api.get<{ url: string }>(
            `/workspaces/${workspaceId}/photos/${photo.id}/download`,
          );
          const blob = await fetch(url).then((response) => response.blob());
          files.push(new File([blob], `Фото ${files.length + 1}.jpg`, { type: blob.type }));
        }
      }

      lines.push(`— ${workspaceName}`);
      setPrepared({ channel, message: { text: lines.join('\n'), files } });
      haptic('light');
    } catch (e) {
      haptic('error');
      await alertDialog(
        e instanceof ApiError ? e.message : `Не удалось подготовить сообщение для ${channel.label}`,
      );
    } finally {
      setSending(null);
    }
  };

  const options: { part: Part; label: string; hint?: string }[] = [
    { part: 'ready', label: 'Сообщение «Машина готова»' },
    {
      part: 'photos',
      label: `Фото${photos.length > 0 ? ` · ${photos.length}` : ''}`,
      hint: 'Уходят файлами только через «Поделиться»',
    },
    { part: 'work_order', label: 'Заказ-наряд PDF' },
    { part: 'completion_act', label: 'Акт выполненных работ PDF' },
    { part: 'info', label: 'Краткая информация по заказу' },
  ];

  const channels = availableChannels();
  const onlyPhotos = parts.size === 1 && parts.has('photos');

  return (
    <Sheet open={open} onClose={onClose} title="Отправить клиенту">
      <div className="pdr-stack">
        <div className="pdr-hint">Что отправить</div>
        {options.map((option) => (
          <label key={option.part} className="pdr-row" style={{ cursor: 'pointer', gap: 10 }}>
            <input
              type="checkbox"
              checked={parts.has(option.part)}
              disabled={option.part === 'photos' && photos.length === 0}
              onChange={() => toggle(option.part)}
            />
            <span className="pdr-grow">
              {option.label}
              {option.hint ? <span className="pdr-hint"> — {option.hint}</span> : null}
            </span>
          </label>
        ))}

        {preview ? (
          <div
            className="pdr-hint"
            style={{
              whiteSpace: 'pre-wrap',
              padding: 10,
              borderRadius: 10,
              background: 'var(--pdr-secondary-bg)',
            }}
          >
            {preview}
          </div>
        ) : null}

        <div className="pdr-hint">Куда</div>
        {channels.map((channel) => (
          <Button
            key={channel.id}
            variant="secondary"
            block
            loading={sending === channel.id}
            disabled={
              parts.size === 0 || sending !== null || (onlyPhotos && !channel.supportsFiles())
            }
            onClick={() => void prepare(channel)}
          >
            {channel.icon} {channel.label}
          </Button>
        ))}
        {prepared ? (
          <div className="pdr-stack" style={{ gap: 8 }}>
            <div
              style={{
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                padding: 10,
                borderRadius: 10,
                background: 'var(--pdr-secondary-bg)',
                fontSize: 13,
              }}
            >
              {prepared.message.text}
              {prepared.message.files && prepared.message.files.length > 0
                ? `\n\n📎 Файлов: ${prepared.message.files.length}`
                : ''}
            </div>
            <Button
              block
              onClick={async () => {
                try {
                  await prepared.channel.open(prepared.message, recipient);
                  haptic('success');
                  onClose();
                } catch {
                  await alertDialog(`Не удалось открыть ${prepared.channel.label}`);
                }
              }}
            >
              Открыть {prepared.channel.label}
            </Button>
          </div>
        ) : null}
        <div className="pdr-hint">
          Мессенджер откроется с готовым сообщением — отправляете его вы. Ссылки на документы
          действуют неделю.
        </div>
        <Button variant="ghost" block onClick={onClose}>
          Отмена
        </Button>
      </div>
    </Sheet>
  );
}
