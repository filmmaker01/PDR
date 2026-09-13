import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { WorkspaceContext } from '../workspace.types';
import type { WorkspaceRequest } from '../guards/workspace.guard';

export const Ws = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): WorkspaceContext => {
    const req = ctx.switchToHttp().getRequest<WorkspaceRequest>();
    if (!req.workspace) {
      throw new Error('@Ws использован на маршруте без @Workspace()');
    }
    return req.workspace;
  },
);
