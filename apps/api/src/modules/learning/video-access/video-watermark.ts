import { createHmac } from 'node:crypto';

/**
 * Метка поверх видео.
 *
 * В неё сознательно не попадают ни имя, ни телефон, ни e-mail: если запись
 * утечёт, вместе с ней утечёт и то, что было на экране. Вместо этого —
 * короткий код, по которому ученика находим только мы, плюс время сессии,
 * чтобы отличать разные просмотры одного человека.
 */

/** Стабильный шестизначный код ученика. Одинаков для всех его просмотров. */
export function watermarkCode(userId: string, secret: string): string {
  return createHmac('sha256', secret)
    .update(`watermark:${userId}`)
    .digest('hex')
    .slice(0, 6)
    .toUpperCase();
}

/** Полная метка: код ученика и время начала просмотра в его часовом поясе UTC. */
export function buildWatermark(userId: string, secret: string, now: Date = new Date()): string {
  const hh = String(now.getUTCHours()).padStart(2, '0');
  const mm = String(now.getUTCMinutes()).padStart(2, '0');
  return `PDR-${watermarkCode(userId, secret)}-${hh}:${mm}`;
}
