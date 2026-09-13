import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash } from 'node:crypto';
import { Observable, from, of, switchMap, tap } from 'rxjs';
import type { Response } from 'express';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { AppError } from '../errors/app.error';
import type { AuthedRequest } from '@/modules/auth/decorators/auth.decorators';

export const IDEMPOTENT = 'pdr:idempotent';

/**
 * Помечает маршрут как идемпотентный: клиент присылает Idempotency-Key,
 * повтор с тем же ключом и телом возвращает сохранённый ответ.
 */
export const Idempotent = (): MethodDecorator => SetMetadata(IDEMPOTENT, true);

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const enabled = this.reflector.getAllAndOverride<boolean>(IDEMPOTENT, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!enabled) return next.handle();

    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const key = req.headers['idempotency-key'];
    if (typeof key !== 'string' || key.length === 0) return next.handle();
    if (key.length > 200) throw AppError.validation('Idempotency-Key слишком длинный');

    const userId = req.auth?.user.id;
    if (!userId) return next.handle();

    const requestHash = createHash('sha256')
      .update(`${req.method}:${req.originalUrl}:${JSON.stringify(req.body ?? {})}`)
      .digest('hex');

    return from(
      this.prisma.idempotencyKey.findUnique({ where: { userId_key: { userId, key } } }),
    ).pipe(
      switchMap((existing) => {
        if (existing) {
          if (existing.requestHash !== requestHash) {
            throw new AppError(
              'idempotency_mismatch',
              'Этот Idempotency-Key уже использован с другими данными',
            );
          }
          const res = context.switchToHttp().getResponse<Response>();
          res.status(existing.responseStatus);
          return of(existing.responseBody);
        }
        return next.handle().pipe(
          tap((body: unknown) => {
            const res = context.switchToHttp().getResponse<Response>();
            void this.prisma.idempotencyKey
              .create({
                data: {
                  userId,
                  key,
                  requestHash,
                  responseStatus: res.statusCode,
                  responseBody: (body ?? {}) as object,
                },
              })
              .catch(() => undefined);
          }),
        );
      }),
    );
  }
}
