import { Injectable, type NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

declare module 'express-serve-static-core' {
  interface Request {
    requestId?: string;
  }
}

/** Присваивает каждому запросу requestId: попадает в логи, аудит и ответ об ошибке. */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.headers['x-request-id'];
    const id = typeof incoming === 'string' && incoming.length <= 128 ? incoming : randomUUID();
    req.requestId = id;
    res.setHeader('X-Request-Id', id);
    next();
  }
}
