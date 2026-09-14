/**
 * Что именно должно быть настроено у бота, и проверки этого.
 *
 * Вынесено отдельно от скрипта настройки: решения здесь чистые и покрыты
 * тестами, а скрипт остаётся тонким слоем сетевых вызовов. Ошибка в списке
 * типов обновлений или в адресе вебхука проявляется не отказом, а тишиной —
 * заявки в клуб просто не приходят, — поэтому проверять это нужно тестом, а
 * не глазами.
 */

/**
 * Типы обновлений, которые нам нужны.
 *
 * Список задаётся явно: Telegram по умолчанию не присылает `chat_member`, а
 * без него мы не узнаем, что человек вышел из клуба или его удалили руками.
 * `my_chat_member` показывает, что бота исключили из группы или лишили прав.
 */
export const ALLOWED_UPDATES = [
  'message',
  'callback_query',
  'chat_join_request',
  'chat_member',
  'my_chat_member',
] as const;

export const BOT_COMMANDS: { command: string; description: string }[] = [
  { command: 'start', description: 'Открыть приложение' },
  { command: 'app', description: 'Открыть приложение' },
  { command: 'help', description: 'Что умеет этот бот' },
];

export interface SetupEnv {
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_BOT_USERNAME?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  TELEGRAM_CLUB_CHAT_ID?: string;
  PUBLIC_API_URL?: string;
  MINIAPP_URL?: string;
}

/** Адрес вебхука. Секрет входит и в путь, и в заголовок: контроллер сверяет оба. */
export function webhookUrl(publicApiUrl: string, secret: string): string {
  return `${publicApiUrl.replace(/\/+$/, '')}/v1/telegram/webhook/${secret}`;
}

/** Секреты не должны попадать в вывод скрипта: его копируют в переписку. */
export function mask(value: string): string {
  if (value.length <= 8) return '***';
  return `${value.slice(0, 4)}…${value.slice(-2)}`;
}

function isHttps(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Проверка окружения до первого сетевого вызова.
 *
 * Telegram на половину этих ошибок отвечает невнятным 400, поэтому дешевле
 * назвать причину самим.
 */
export function validateSetup(env: SetupEnv): string[] {
  const problems: string[] = [];

  if (!env.TELEGRAM_BOT_TOKEN) {
    problems.push('TELEGRAM_BOT_TOKEN не задан');
  } else if (!/^\d+:[A-Za-z0-9_-]{30,}$/.test(env.TELEGRAM_BOT_TOKEN)) {
    problems.push('TELEGRAM_BOT_TOKEN не похож на токен BotFather (<id>:<строка>)');
  }

  if (!env.TELEGRAM_BOT_USERNAME) {
    problems.push('TELEGRAM_BOT_USERNAME не задан');
  } else if (env.TELEGRAM_BOT_USERNAME.startsWith('@')) {
    problems.push('TELEGRAM_BOT_USERNAME указывается без @');
  }

  const secret = env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) {
    problems.push('TELEGRAM_WEBHOOK_SECRET не задан');
  } else if (!/^[A-Za-z0-9_-]{16,256}$/.test(secret)) {
    // Ограничение Telegram на secret_token — A-Z, a-z, 0-9, _ и -; этот же
    // секрет идёт сегментом пути, поэтому другие символы сломали бы маршрут.
    problems.push(
      'TELEGRAM_WEBHOOK_SECRET: допустимы только A-Z a-z 0-9 _ - , длина от 16 до 256 символов',
    );
  }

  if (!env.PUBLIC_API_URL) {
    problems.push('PUBLIC_API_URL не задан');
  } else if (!isHttps(env.PUBLIC_API_URL)) {
    problems.push('PUBLIC_API_URL должен быть https: Telegram не доставляет вебхук на http');
  }

  if (!env.MINIAPP_URL) {
    problems.push('MINIAPP_URL не задан');
  } else if (!isHttps(env.MINIAPP_URL)) {
    problems.push('MINIAPP_URL должен быть https: кнопка меню Mini App требует https');
  }

  if (env.TELEGRAM_CLUB_CHAT_ID && !/^-?\d+$/.test(env.TELEGRAM_CLUB_CHAT_ID)) {
    problems.push('TELEGRAM_CLUB_CHAT_ID — числовой id чата (у супергруппы начинается с -100)');
  }

  return problems;
}

export interface WebhookInfo {
  url?: string;
  has_custom_certificate?: boolean;
  pending_update_count?: number;
  allowed_updates?: string[];
  last_error_message?: string;
  last_error_date?: number;
}

/** Расхождения между тем, что настроено у Telegram, и тем, что нужно нам. */
export function diffWebhook(info: WebhookInfo, expectedUrl: string): string[] {
  const problems: string[] = [];

  if (!info.url) {
    problems.push('вебхук не установлен');
  } else if (info.url !== expectedUrl) {
    problems.push(`вебхук указывает на другой адрес: ${maskUrlSecret(info.url)}`);
  }

  // Пустой список у Telegram означает «набор по умолчанию», а в нём нет
  // chat_member — то есть выход из клуба до нас не дойдёт.
  const actual = info.allowed_updates ?? [];
  const missing = ALLOWED_UPDATES.filter((type) => !actual.includes(type));
  if (missing.length > 0) {
    problems.push(`не подписаны на обновления: ${missing.join(', ')}`);
  }

  if (info.last_error_message) {
    const when = info.last_error_date ? new Date(info.last_error_date * 1000).toISOString() : '';
    problems.push(`последняя доставка не удалась (${when}): ${info.last_error_message}`);
  }

  return problems;
}

/** В адресе вебхука последним сегментом идёт секрет. */
export function maskUrlSecret(url: string): string {
  const cut = url.lastIndexOf('/');
  if (cut < 0) return url;
  return `${url.slice(0, cut + 1)}${mask(url.slice(cut + 1))}`;
}

export interface ChatMemberInfo {
  status?: string;
  can_invite_users?: boolean;
  can_restrict_members?: boolean;
}

/**
 * Права бота в группе клуба.
 *
 * Одобрять заявки позволяет can_invite_users, удалять — can_restrict_members.
 * Без первого клуб не работает вообще, без второго не работает отзыв доступа.
 */
export function clubRightsProblems(member: ChatMemberInfo): string[] {
  if (member.status !== 'administrator') {
    return [`бот в группе не администратор (статус: ${member.status ?? 'неизвестен'})`];
  }

  const problems: string[] = [];
  if (!member.can_invite_users) {
    problems.push('нет права «Приглашать пользователей» — заявки нельзя одобрять');
  }
  if (!member.can_restrict_members) {
    problems.push('нет права «Блокировать пользователей» — нельзя исключать при отзыве доступа');
  }
  return problems;
}
