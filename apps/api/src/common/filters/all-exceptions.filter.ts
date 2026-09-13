import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { ApiErrorBody, ErrorCode } from '@pdr/shared';
import { AppError } from '../errors/app.error';

/** Единый формат ответа об ошибке: { error: { code, message, details?, requestId } }. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpException');

  constructor(private readonly exposeInternals: boolean) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { requestId?: string }>();
    const requestId = req.requestId ?? (req.headers['x-request-id'] as string | undefined);

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: ErrorCode = 'internal_error';
    let message = 'Внутренняя ошибка сервера';
    let details: unknown;

    if (exception instanceof AppError) {
      status = exception.getStatus();
      const body = exception.getResponse() as {
        code: ErrorCode;
        message: string;
        details?: unknown;
      };
      code = body.code;
      message = body.message;
      details = body.details;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      code = mapHttpStatusToCode(status);
      message =
        typeof body === 'string'
          ? body
          : (((body as { message?: string | string[] }).message as string) ?? exception.message);
      if (Array.isArray(message)) message = message.join('; ');
    } else if (exception instanceof Error) {
      this.logger.error({ err: exception, requestId }, exception.message);
      if (this.exposeInternals) {
        message = exception.message;
        details = { stack: exception.stack };
      }
    }

    if (status >= 500) {
      this.logger.error({ requestId, code, err: exception }, message);
    }

    const payload: ApiErrorBody = { error: { code, message, requestId } };
    if (details !== undefined) payload.error.details = details;
    res.status(status).json(payload);
  }
}

function mapHttpStatusToCode(status: number): ErrorCode {
  switch (status) {
    case HttpStatus.UNAUTHORIZED:
      return 'unauthorized';
    case HttpStatus.FORBIDDEN:
      return 'forbidden';
    case HttpStatus.NOT_FOUND:
      return 'not_found';
    case HttpStatus.CONFLICT:
      return 'conflict';
    case HttpStatus.UNPROCESSABLE_ENTITY:
      return 'validation_failed';
    case HttpStatus.TOO_MANY_REQUESTS:
      return 'rate_limited';
    case HttpStatus.SERVICE_UNAVAILABLE:
      return 'service_unavailable';
    default:
      return status >= 500 ? 'internal_error' : 'validation_failed';
  }
}
