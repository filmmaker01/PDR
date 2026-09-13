import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PlatformRoleName } from '@prisma/client';
import { AppError } from '@/common/errors/app.error';
import { REQUIRED_PLATFORM_ROLES, type AuthedRequest } from '../decorators/auth.decorators';

@Injectable()
export class PlatformRoleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<PlatformRoleName[]>(REQUIRED_PLATFORM_ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const roles = req.auth?.platformRoles ?? [];
    if (!required.some((r) => roles.includes(r))) {
      throw new AppError('platform_role_required', 'Раздел доступен только сотрудникам платформы');
    }
    return true;
  }
}
