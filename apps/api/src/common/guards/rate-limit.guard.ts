import { type CanActivate, type ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AppError } from '../errors/app.error';

export interface RateLimitOptions {
  /** Разрешённое количество запросов в окне. */
  limit: number;
  /** Длина окна в секундах. */
  windowSec: number;
  /** Дополнительный ключ (например, telegram id из тела) — берётся из запроса. */
  keyFrom?: (req: Request) => string | null;
}

export const RATE_LIMIT = 'pdr:rate-limit';
export const RateLimit = (options: RateLimitOptions): MethodDecorator & ClassDecorator =>
  SetMetadata(RATE_LIMIT, options);

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Ограничение частоты в памяти процесса.
 * Для одного-двух экземпляров API этого достаточно; при горизонтальном
 * масштабировании счётчик переносится в PostgreSQL или Redis.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly buckets = new Map<string, Bucket>();
  private lastSweep = Date.now();

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const options = this.reflector.getAllAndOverride<RateLimitOptions>(RATE_LIMIT, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!options) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const extra = options.keyFrom?.(req) ?? '';
    const ip =
      (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ??
      req.ip ??
      'unknown';
    const route = `${req.method}:${req.route?.path ?? req.path}`;
    const key = `${route}|${ip}|${extra}`;

    this.sweep();

    const now = Date.now();
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + options.windowSec * 1000 });
      return true;
    }
    if (bucket.count >= options.limit) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      throw new AppError(
        'rate_limited',
        `Слишком много запросов. Повторите через ${retryAfter} с`,
        {
          retryAfter,
        },
      );
    }
    bucket.count += 1;
    return true;
  }

  private sweep(): void {
    const now = Date.now();
    if (now - this.lastSweep < 60_000) return;
    this.lastSweep = now;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}
