import { getWebApp, isInsideTelegram } from './telegram';

/**
 * Сообщение клиенту, которое мастер отправляет сам.
 *
 * Приложение ничего не отправляет от имени мастерской: канал только
 * открывается с готовым текстом, а кнопку «Отправить» нажимает мастер.
 * Угадывать, в каком мессенджере зарегистрирован клиент, не нужно — мастер
 * выбирает канал сам.
 */
export interface OutgoingMessage {
  text: string;
  /** Файлы (фото, PDF): уходят только через системное «Поделиться». */
  files?: File[];
}

/** Кому пишем: канал сам решает, чем из этого он умеет воспользоваться. */
export interface MessageRecipient {
  name: string;
  phone: string | null;
  /** Username в Telegram, если он сохранён у клиента. Номер для Telegram не годится. */
  telegramUsername?: string | null;
}

export type MessageChannelId = 'max' | 'telegram' | 'system';

/**
 * Канал сообщения. Сейчас все каналы «открывают» мессенджер с текстом.
 *
 * Когда появится бот MAX и у клиента будет известен его chat_id, прямая
 * отправка добавится ещё одним каналом с той же формой: экраны при этом
 * не меняются. Одного номера телефона для серверной отправки недостаточно.
 */
export interface MessageChannel {
  id: MessageChannelId;
  label: string;
  icon: string;
  /** Может ли канал открыться на этом устройстве. */
  available: () => boolean;
  /** Умеет ли канал приложить файлы. Если нет — в текст идут ссылки. */
  supportsFiles: () => boolean;
  open: (message: OutgoingMessage, recipient: MessageRecipient) => Promise<void>;
}

/** Внешняя ссылка: из Telegram — его средствами, иначе новой вкладкой. */
function openExternal(url: string): void {
  const wa = isInsideTelegram() ? getWebApp() : null;
  if (!wa) {
    window.open(url, '_blank', 'noopener');
    return;
  }
  if (/^https:\/\/t\.me\//.test(url)) wa.openTelegramLink(url);
  else wa.openLink(url);
}

/** Официальный share-deeplink MAX: экран «Отправить в MAX» с готовым текстом. */
export function maxShareUrl(text: string): string {
  return `https://max.ru/:share?text=${encodeURIComponent(text)}`;
}

/**
 * Ссылка Telegram. С username — личный чат клиента с черновиком сообщения.
 * Без него — выбор чата: открыть личный чат по одному номеру нельзя.
 */
export function telegramUrl(text: string, username?: string | null): string {
  const handle = username?.trim().replace(/^@/, '');
  if (handle && /^[A-Za-z0-9_]{4,32}$/.test(handle)) {
    return `https://t.me/${handle}?text=${encodeURIComponent(text)}`;
  }
  // У share-ссылки обязательный параметр url: первая ссылка из текста, если есть.
  const link = text.match(/https?:\/\/\S+/)?.[0];
  const url = link ?? text;
  const rest = link ? text.replace(link, '').trim() : '';
  return `https://t.me/share/url?url=${encodeURIComponent(url)}${
    rest ? `&text=${encodeURIComponent(rest)}` : ''
  }`;
}

function canShareFiles(files: File[]): boolean {
  if (typeof navigator.canShare !== 'function') return false;
  try {
    return navigator.canShare({ files });
  } catch {
    return false;
  }
}

export const MAX_CHANNEL: MessageChannel = {
  id: 'max',
  label: 'MAX',
  icon: '🟦',
  available: () => true,
  supportsFiles: () => false,
  open: async (message) => openExternal(maxShareUrl(message.text)),
};

export const TELEGRAM_CHANNEL: MessageChannel = {
  id: 'telegram',
  label: 'Telegram',
  icon: '✈️',
  available: () => true,
  supportsFiles: () => false,
  open: async (message, recipient) =>
    openExternal(telegramUrl(message.text, recipient.telegramUsername)),
};

export const SYSTEM_SHARE_CHANNEL: MessageChannel = {
  id: 'system',
  label: 'Поделиться',
  icon: '↗',
  available: () => typeof navigator.share === 'function',
  // Проверяется на пробном PDF: умеет делиться текстом ещё не значит умеет
  // файлами, и документ иначе молча выпал бы из сообщения.
  supportsFiles: () =>
    typeof navigator.share === 'function' &&
    canShareFiles([new File(['%PDF'], 'probe.pdf', { type: 'application/pdf' })]),
  open: async (message) => {
    const files = message.files ?? [];
    const withFiles = files.length > 0 && canShareFiles(files);
    try {
      await navigator.share(withFiles ? { text: message.text, files } : { text: message.text });
    } catch (error) {
      // Мастер закрыл системное окно — это не ошибка.
      if (error instanceof DOMException && error.name === 'AbortError') return;
      throw error;
    }
  },
};

export const MESSAGE_CHANNELS: readonly MessageChannel[] = [
  MAX_CHANNEL,
  TELEGRAM_CHANNEL,
  SYSTEM_SHARE_CHANNEL,
];

/** Копирование: clipboard есть не во всех WebView, поэтому с запасным путём. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Упадём на запасной путь ниже.
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    area.remove();
  }
}
