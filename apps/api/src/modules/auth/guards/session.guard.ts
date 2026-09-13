import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppError } from '@/common/errors/app.error';
import { UsersService } from '@/modules/users/users.service';
import { SessionService } from '../session.service';
import { PUBLIC_ROUTE, type AuthedRequest } from '../decorators/auth.decorators';

/**
 * Глобальный guard: любая ручка требует действующей сессии,
 * пока явно не помечена @Public(). Так новый эндпоинт по умолчанию закрыт.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly users: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new AppError('unauthorized', 'Требуется авторизация');
    }

    const { user, session } = await this.sessions.authenticate(header.slice(7).trim());
    const platformRoles = await this.users.platformRoles(user.id);
    req.auth = { user, session, platformRoles };
    return true;
  }
}
