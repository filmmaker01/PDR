/** Коды ошибок API. Сообщения формирует сервер (на русском). */
export const ERROR_CODES = [
  // auth
  'unauthorized',
  'invalid_init_data',
  'invalid_login_data',
  'session_revoked',
  'user_banned',
  'refresh_reused',
  'login_request_not_found',
  // права и доступы
  'forbidden',
  'not_found',
  'product_access_required',
  'stage_locked',
  'workspace_access_required',
  'platform_role_required',
  // валидация
  'validation_failed',
  'idempotency_mismatch',
  'unsupported_file_type',
  'file_too_large',
  'file_not_ready',
  // состояния
  'conflict',
  'invalid_transition',
  'overlap',
  'already_exists',
  'estimate_immutable',
  'submission_in_progress',
  'attempt_in_progress',
  'attempt_limit_reached',
  'attempt_cooldown',
  'exam_expired',
  'version_immutable',
  'publish_validation_failed',
  // прочее
  'ai_unavailable',
  'ai_failed',
  'rate_limited',
  'internal_error',
  'service_unavailable',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}
