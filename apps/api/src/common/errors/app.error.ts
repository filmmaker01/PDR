import { HttpException, HttpStatus } from '@nestjs/common';
import type { ErrorCode } from '@pdr/shared';

const STATUS_BY_CODE: Partial<Record<ErrorCode, HttpStatus>> = {
  unauthorized: HttpStatus.UNAUTHORIZED,
  invalid_init_data: HttpStatus.UNAUTHORIZED,
  invalid_login_data: HttpStatus.UNAUTHORIZED,
  session_revoked: HttpStatus.UNAUTHORIZED,
  user_banned: HttpStatus.UNAUTHORIZED,
  refresh_reused: HttpStatus.UNAUTHORIZED,
  login_request_not_found: HttpStatus.NOT_FOUND,

  forbidden: HttpStatus.FORBIDDEN,
  product_access_required: HttpStatus.FORBIDDEN,
  stage_locked: HttpStatus.FORBIDDEN,
  workspace_access_required: HttpStatus.FORBIDDEN,
  platform_role_required: HttpStatus.FORBIDDEN,
  not_found: HttpStatus.NOT_FOUND,

  validation_failed: HttpStatus.UNPROCESSABLE_ENTITY,
  idempotency_mismatch: HttpStatus.UNPROCESSABLE_ENTITY,
  unsupported_file_type: HttpStatus.UNPROCESSABLE_ENTITY,
  file_too_large: HttpStatus.UNPROCESSABLE_ENTITY,
  file_not_ready: HttpStatus.UNPROCESSABLE_ENTITY,

  conflict: HttpStatus.CONFLICT,
  invalid_transition: HttpStatus.CONFLICT,
  overlap: HttpStatus.CONFLICT,
  already_exists: HttpStatus.CONFLICT,
  estimate_immutable: HttpStatus.CONFLICT,
  submission_in_progress: HttpStatus.CONFLICT,
  attempt_in_progress: HttpStatus.CONFLICT,
  attempt_limit_reached: HttpStatus.CONFLICT,
  attempt_cooldown: HttpStatus.CONFLICT,
  exam_expired: HttpStatus.CONFLICT,
  version_immutable: HttpStatus.CONFLICT,
  publish_validation_failed: HttpStatus.UNPROCESSABLE_ENTITY,

  rate_limited: HttpStatus.TOO_MANY_REQUESTS,
  internal_error: HttpStatus.INTERNAL_SERVER_ERROR,
  service_unavailable: HttpStatus.SERVICE_UNAVAILABLE,
};

/**
 * Доменная ошибка с кодом из общего перечня.
 * Сообщение — на русском, показывается пользователю как есть.
 */
export class AppError extends HttpException {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super({ code, message, details }, STATUS_BY_CODE[code] ?? HttpStatus.BAD_REQUEST);
  }

  static notFound(message = 'Не найдено'): AppError {
    return new AppError('not_found', message);
  }

  static forbidden(message = 'Недостаточно прав'): AppError {
    return new AppError('forbidden', message);
  }

  static validation(message: string, details?: unknown): AppError {
    return new AppError('validation_failed', message, details);
  }

  static conflict(message: string, details?: unknown): AppError {
    return new AppError('conflict', message, details);
  }
}
