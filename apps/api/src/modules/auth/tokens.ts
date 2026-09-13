import { createHmac, randomBytes, timingSafeEqual, createHash } from 'node:crypto';

/**
 * Компактный JWT (HS256) без внешней зависимости.
 * Access-токен намеренно не содержит ролей и доступов: они читаются из базы
 * на каждом запросе, поэтому отзыв действует немедленно.
 */

export interface AccessTokenPayload {
  /** user id */
  sub: string;
  /** session id */
  sid: string;
  kind: 'miniapp' | 'web';
  iat: number;
  exp: number;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

export function signAccessToken(
  payload: Omit<AccessTokenPayload, 'iat' | 'exp'>,
  secret: string,
  ttlSec: number,
  now: Date = new Date(),
): string {
  const iat = Math.floor(now.getTime() / 1000);
  const body: AccessTokenPayload = { ...payload, iat, exp: iat + ttlSec };
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const claims = base64url(JSON.stringify(body));
  const signature = createHmac('sha256', secret).update(`${header}.${claims}`).digest('base64url');
  return `${header}.${claims}.${signature}`;
}

export type TokenFailure = 'malformed' | 'bad_signature' | 'expired';

export class TokenError extends Error {
  constructor(readonly reason: TokenFailure) {
    super(`token verification failed: ${reason}`);
    this.name = 'TokenError';
  }
}

export function verifyAccessToken(
  token: string,
  secret: string,
  now: Date = new Date(),
): AccessTokenPayload {
  const parts = token.split('.');
  if (parts.length !== 3) throw new TokenError('malformed');
  const [header, claims, signature] = parts as [string, string, string];

  const expected = createHmac('sha256', secret).update(`${header}.${claims}`).digest('base64url');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new TokenError('bad_signature');

  let payload: AccessTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(claims, 'base64url').toString('utf8')) as AccessTokenPayload;
  } catch {
    throw new TokenError('malformed');
  }
  if (!payload.sub || !payload.sid || !payload.exp) throw new TokenError('malformed');
  if (payload.exp * 1000 <= now.getTime()) throw new TokenError('expired');
  return payload;
}

/** Непрозрачный refresh-токен. В базе хранится только его sha256. */
export function generateRefreshToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashRefreshToken(token) };
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Короткий код для подтверждения входа в админку через бота. */
export function generateLoginCode(): string {
  return randomBytes(9).toString('base64url');
}
