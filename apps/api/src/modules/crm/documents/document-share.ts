import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Ссылка на документ заказа для клиента.
 *
 * Мастер отправляет клиенту заказ-наряд в мессенджер, а у клиента нет входа
 * в мастерскую. Поэтому ссылка сама несёт разрешение: какой документ какого
 * заказа, до какого момента, и подпись сервера. Подделать или продлить её
 * нельзя, а вывести из неё можно только этот один документ.
 *
 * Подпись отделена от сессионной своим префиксом: токен документа не может
 * сойти за токен входа и наоборот, хотя секрет у них общий.
 */
const DOMAIN = 'pdr:order-document-share:v1';

/** Сколько живёт ссылка: клиент открывает её не сразу, но и не через месяц. */
export const DOCUMENT_SHARE_TTL_SEC = 7 * 24 * 60 * 60;

export interface DocumentShareClaims {
  workspaceId: string;
  orderId: string;
  kind: string;
  /** Unix-время окончания, в секундах. */
  exp: number;
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(`${DOMAIN}.${payload}`).digest('base64url');
}

export function signDocumentShare(claims: DocumentShareClaims, secret: string): string {
  const payload = Buffer.from(
    JSON.stringify({ w: claims.workspaceId, o: claims.orderId, k: claims.kind, e: claims.exp }),
  ).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

/** Разбор ссылки: null — подпись не сошлась, токен испорчен или истёк. */
export function verifyDocumentShare(
  token: string,
  secret: string,
  now: Date = new Date(),
): DocumentShareClaims | null {
  const [payload, signature, ...rest] = token.split('.');
  if (!payload || !signature || rest.length > 0) return null;

  const expected = Buffer.from(sign(payload, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

  try {
    const raw = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    const claims: DocumentShareClaims = {
      workspaceId: String(raw.w ?? ''),
      orderId: String(raw.o ?? ''),
      kind: String(raw.k ?? ''),
      exp: Number(raw.e),
    };
    if (!claims.workspaceId || !claims.orderId || !claims.kind) return null;
    if (!Number.isFinite(claims.exp) || claims.exp * 1000 <= now.getTime()) return null;
    return claims;
  } catch {
    return null;
  }
}
