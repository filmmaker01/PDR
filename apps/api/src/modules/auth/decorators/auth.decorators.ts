import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { PlatformRoleName, Session, User } from '@prisma/client';
import type { Request } from 'express';

export const PUBLIC_ROUTE = 'pdr:public';
export const REQUIRED_PLATFORM_ROLES = 'pdr:platform-roles';

/** Маршрут доступен без сессии. */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(PUBLIC_ROUTE, true);

/** Маршрут требует одной из перечисленных ролей платформы. */
export const PlatformRoles = (...roles: PlatformRoleName[]): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRED_PLATFORM_ROLES, roles);

export interface AuthContext {
  user: User;
  session: Session;
  platformRoles: PlatformRoleName[];
}

export interface AuthedRequest extends Request {
  auth?: AuthContext;
  requestId?: string;
}

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): User => {
  const req = ctx.switchToHttp().getRequest<AuthedRequest>();
  if (!req.auth) throw new Error('CurrentUser использован на маршруте без SessionGuard');
  return req.auth.user;
});

export const CurrentAuth = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthContext => {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    if (!req.auth) throw new Error('CurrentAuth использован на маршруте без SessionGuard');
    return req.auth;
  },
);

export const RequestId = createParamDecorator((_d: unknown, ctx: ExecutionContext): string => {
  const req = ctx.switchToHttp().getRequest<AuthedRequest>();
  return req.requestId ?? '';
});
