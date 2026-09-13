import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Проверка подписи данных Telegram.
 * Два разных алгоритма:
 *  - Mini App (initData): secret = HMAC_SHA256(key="WebAppData", data=BOT_TOKEN)
 *  - Login Widget:        secret = SHA256(BOT_TOKEN)
 * Документация: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *               https://core.telegram.org/widgets/login#checking-authorization
 */

export interface TelegramUserPayload {
  id: string;
  firstName: string;
  lastName: string | null;
  username: string | null;
  languageCode: string | null;
  photoUrl: string | null;
  allowsWriteToPm: boolean;
  isPremium: boolean;
}

export interface InitDataResult {
  user: TelegramUserPayload;
  authDate: Date;
  startParam: string | null;
  chatInstance: string | null;
  queryId: string | null;
}

export type VerifyFailure =
  'malformed' | 'missing_hash' | 'missing_auth_date' | 'bad_signature' | 'expired' | 'missing_user';

export class InitDataError extends Error {
  constructor(readonly reason: VerifyFailure) {
    super(`initData verification failed: ${reason}`);
    this.name = 'InitDataError';
  }
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** data_check_string: пары key=value, отсортированные по ключу, через \n. */
export function buildDataCheckString(pairs: Iterable<[string, string]>, exclude = 'hash'): string {
  return [...pairs]
    .filter(([key]) => key !== exclude)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
}

/**
 * Разбор и проверка initData из Mini App.
 * `initDataUnsafe` с клиента не принимается ни при каких условиях.
 */
export function verifyInitData(
  initData: string,
  botToken: string,
  maxAgeSec: number,
  now: Date = new Date(),
): InitDataResult {
  if (!initData || initData.length > 8192) throw new InitDataError('malformed');

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(initData);
  } catch {
    throw new InitDataError('malformed');
  }

  const hash = params.get('hash');
  if (!hash) throw new InitDataError('missing_hash');

  const authDateRaw = params.get('auth_date');
  if (!authDateRaw) throw new InitDataError('missing_auth_date');

  const dataCheckString = buildDataCheckString(params.entries());
  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  if (!constantTimeEquals(expected, hash)) throw new InitDataError('bad_signature');

  const authDateSec = Number(authDateRaw);
  if (!Number.isFinite(authDateSec)) throw new InitDataError('missing_auth_date');
  const ageSec = Math.floor(now.getTime() / 1000) - authDateSec;
  if (ageSec > maxAgeSec || ageSec < -60) throw new InitDataError('expired');

  const userRaw = params.get('user');
  if (!userRaw) throw new InitDataError('missing_user');

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(userRaw) as Record<string, unknown>;
  } catch {
    throw new InitDataError('missing_user');
  }
  if (typeof parsed.id !== 'number' && typeof parsed.id !== 'string') {
    throw new InitDataError('missing_user');
  }

  return {
    user: {
      id: String(parsed.id),
      firstName: typeof parsed.first_name === 'string' ? parsed.first_name : '',
      lastName: typeof parsed.last_name === 'string' ? parsed.last_name : null,
      username: typeof parsed.username === 'string' ? parsed.username : null,
      languageCode: typeof parsed.language_code === 'string' ? parsed.language_code : null,
      photoUrl: typeof parsed.photo_url === 'string' ? parsed.photo_url : null,
      allowsWriteToPm: parsed.allows_write_to_pm === true,
      isPremium: parsed.is_premium === true,
    },
    authDate: new Date(authDateSec * 1000),
    startParam: params.get('start_param'),
    chatInstance: params.get('chat_instance'),
    queryId: params.get('query_id'),
  };
}

/** Проверка данных Telegram Login Widget (вход в веб-админку). */
export function verifyLoginWidget(
  data: Record<string, unknown>,
  botToken: string,
  maxAgeSec: number,
  now: Date = new Date(),
): TelegramUserPayload & { authDate: Date } {
  const hash = data.hash;
  if (typeof hash !== 'string' || !hash) throw new InitDataError('missing_hash');

  const authDateSec = Number(data.auth_date);
  if (!Number.isFinite(authDateSec)) throw new InitDataError('missing_auth_date');

  const pairs: [string, string][] = Object.entries(data)
    .filter(([key, value]) => key !== 'hash' && value !== undefined && value !== null)
    .map(([key, value]) => [key, String(value)]);

  const dataCheckString = buildDataCheckString(pairs);
  const secretKey = createHash('sha256').update(botToken).digest();
  const expected = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  if (!constantTimeEquals(expected, hash)) throw new InitDataError('bad_signature');

  const ageSec = Math.floor(now.getTime() / 1000) - authDateSec;
  if (ageSec > maxAgeSec || ageSec < -60) throw new InitDataError('expired');

  if (data.id === undefined || data.id === null) throw new InitDataError('missing_user');

  return {
    id: String(data.id),
    firstName: typeof data.first_name === 'string' ? data.first_name : '',
    lastName: typeof data.last_name === 'string' ? data.last_name : null,
    username: typeof data.username === 'string' ? data.username : null,
    languageCode: null,
    photoUrl: typeof data.photo_url === 'string' ? data.photo_url : null,
    allowsWriteToPm: false,
    isPremium: false,
    authDate: new Date(authDateSec * 1000),
  };
}

/** Сборка валидного initData — используется в тестах и локальной разработке. */
export function signInitData(fields: Record<string, string>, botToken: string): string {
  const dataCheckString = buildDataCheckString(Object.entries(fields));
  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  const params = new URLSearchParams(fields);
  params.set('hash', hash);
  return params.toString();
}

export function signLoginWidget(
  fields: Record<string, string | number>,
  botToken: string,
): Record<string, string | number> {
  const pairs: [string, string][] = Object.entries(fields).map(([k, v]) => [k, String(v)]);
  const dataCheckString = buildDataCheckString(pairs);
  const secretKey = createHash('sha256').update(botToken).digest();
  const hash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  return { ...fields, hash };
}
