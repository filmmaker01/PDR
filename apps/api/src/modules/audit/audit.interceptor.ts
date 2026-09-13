import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, tap } from 'rxjs';
import { AuditService } from './audit.service';
import type { WorkspaceRequest } from '@/modules/workspaces/guards/workspace.guard';

export const AUDITED = 'pdr:audited';

export interface AuditedOptions {
  entityType: string;
  /** Если не задано — берётся из HTTP-метода. */
  action?: string;
  /** Откуда взять идентификатор сущности: параметр пути или поле ответа. */
  idFrom?: { param?: string; responseField?: string };
}

/** Помечает маршрут как записываемый в журнал действий. */
export const Audited = (options: AuditedOptions): MethodDecorator => SetMetadata(AUDITED, options);

const ACTION_BY_METHOD: Record<string, string> = {
  POST: 'create',
  PATCH: 'update',
  PUT: 'update',
  DELETE: 'delete',
};

/**
 * Автоматическая запись мутирующих запросов.
 * Детальные снимки «до/после» сервисы пишут сами через AuditService —
 * перехватчик фиксирует сам факт действия и его контекст.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const options = this.reflector.getAllAndOverride<AuditedOptions>(AUDITED, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!options) return next.handle();

    const req = context.switchToHttp().getRequest<WorkspaceRequest>();

    return next.handle().pipe(
      tap((body: unknown) => {
        const responseId =
          options.idFrom?.responseField && body && typeof body === 'object'
            ? ((body as Record<string, unknown>)[options.idFrom.responseField] as
                string | undefined)
            : undefined;
        const paramId = options.idFrom?.param ? req.params?.[options.idFrom.param] : undefined;

        void this.audit.record({
          requestId: req.requestId,
          actorUserId: req.auth?.user.id ?? null,
          actorRoleContext: req.workspace
            ? `workspace:${req.workspace.role}`
            : req.auth?.platformRoles.join(',') || 'user',
          workspaceId: req.workspace?.workspaceId ?? null,
          entityType: options.entityType,
          entityId: responseId ?? (typeof paramId === 'string' ? paramId : null),
          action: options.action ?? ACTION_BY_METHOD[req.method] ?? req.method.toLowerCase(),
          ip:
            (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ??
            req.ip ??
            null,
          userAgent: req.headers['user-agent'] ?? null,
        });
      }),
    );
  }
}
