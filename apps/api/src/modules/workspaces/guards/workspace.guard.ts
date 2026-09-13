import { type CanActivate, type ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { WorkspacePermission } from '@pdr/shared';
import { AppError } from '@/common/errors/app.error';
import type { AuthedRequest } from '@/modules/auth/decorators/auth.decorators';
import { WorkspacesService } from '../workspaces.service';
import type { WorkspaceContext } from '../workspace.types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const WORKSPACE_ROUTE = 'pdr:workspace';
export const WORKSPACE_PERMISSION = 'pdr:workspace-permission';
export const ALLOW_READONLY_ACCESS = 'pdr:workspace-readonly-ok';

/** Маршрут работает в контексте мастерской (`:workspaceId` в пути). */
export const Workspace = (): MethodDecorator & ClassDecorator => SetMetadata(WORKSPACE_ROUTE, true);

/** Требуемое право участника мастерской. */
export const Can = (permission: WorkspacePermission): MethodDecorator =>
  SetMetadata(WORKSPACE_PERMISSION, permission);

/**
 * Маршрут доступен и при истёкшем доступе к CRM.
 * Ставится на чтение и экспорт: данные мастера остаются при нём.
 */
export const AllowExpiredAccess = (): MethodDecorator => SetMetadata(ALLOW_READONLY_ACCESS, true);

export interface WorkspaceRequest extends AuthedRequest {
  workspace?: WorkspaceContext;
}

@Injectable()
export class WorkspaceGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly workspaces: WorkspacesService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const enabled = this.reflector.getAllAndOverride<boolean>(WORKSPACE_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!enabled) return true;

    const req = context.switchToHttp().getRequest<WorkspaceRequest>();
    const userId = req.auth?.user.id;
    if (!userId) throw new AppError('unauthorized', 'Требуется авторизация');

    const raw = req.params?.workspaceId;
    const workspaceId = typeof raw === 'string' ? raw : null;
    if (!workspaceId || !UUID_RE.test(workspaceId))
      throw AppError.notFound('Мастерская не найдена');

    const ctx = await this.workspaces.buildContext(workspaceId, userId);

    const permission = this.reflector.getAllAndOverride<WorkspacePermission>(WORKSPACE_PERMISSION, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (permission && !ctx.permissions.has(permission)) {
      // Право отсутствует у роли — объект для пользователя как будто не существует.
      throw AppError.notFound('Раздел недоступен');
    }

    if (!ctx.hasActiveAccess) {
      const readonlyOk = this.reflector.getAllAndOverride<boolean>(ALLOW_READONLY_ACCESS, [
        context.getHandler(),
        context.getClass(),
      ]);
      const isRead = req.method === 'GET' || req.method === 'HEAD';
      if (!isRead && !readonlyOk) {
        throw new AppError(
          'product_access_required',
          ctx.accessValidUntil
            ? 'Доступ к CRM завершён. Данные доступны для просмотра и выгрузки'
            : 'Доступ к CRM не активирован',
        );
      }
    }

    req.workspace = ctx;
    return true;
  }
}
