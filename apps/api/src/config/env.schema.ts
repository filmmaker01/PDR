import { z } from 'zod';

const bool = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((v) => v === true || v === 'true' || v === '1');

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_ENV: z.enum(['local', 'test', 'staging', 'production']).default('local'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    PUBLIC_API_URL: z.string().url(),
    MINIAPP_URL: z.string().url(),
    ADMIN_URL: z.string().url(),

    DATABASE_URL: z.string().min(1),

    SESSION_JWT_SECRET: z.string().min(32, 'SESSION_JWT_SECRET должен быть не короче 32 символов'),
    ACCESS_TOKEN_TTL_SEC: z.coerce.number().int().positive().default(900),
    REFRESH_TOKEN_TTL_SEC: z.coerce.number().int().positive().default(2_592_000),

    TELEGRAM_ENABLED: bool.default(false),
    TELEGRAM_BOT_TOKEN: z.string().default(''),
    TELEGRAM_BOT_USERNAME: z.string().default(''),
    TELEGRAM_WEBHOOK_SECRET: z.string().default(''),
    TELEGRAM_CLUB_CHAT_ID: z.string().default(''),
    /// Постоянная ссылка-заявка в группу клуба (creates_join_request).
    TELEGRAM_CLUB_INVITE_LINK: z.string().default(''),
    TELEGRAM_INITDATA_MAX_AGE_SEC: z.coerce.number().int().positive().default(300),
    TELEGRAM_LOGIN_MAX_AGE_SEC: z.coerce.number().int().positive().default(300),

    STORAGE_DRIVER: z.enum(['s3', 'local']).default('local'),
    STORAGE_LOCAL_DIR: z.string().default('./storage-local'),
    S3_ENDPOINT: z.string().default(''),
    S3_REGION: z.string().default('ru-central1'),
    S3_BUCKET: z.string().default('pdr-local'),
    S3_ACCESS_KEY: z.string().default(''),
    S3_SECRET_KEY: z.string().default(''),
    S3_FORCE_PATH_STYLE: bool.default(true),
    S3_PRESIGN_UPLOAD_TTL_SEC: z.coerce.number().int().positive().default(600),
    S3_PRESIGN_DOWNLOAD_TTL_SEC: z.coerce.number().int().positive().default(300),
    FILE_MAX_SIZE_IMAGE: z.coerce
      .number()
      .int()
      .positive()
      .default(20 * 1024 * 1024),
    FILE_MAX_SIZE_VIDEO: z.coerce
      .number()
      .int()
      .positive()
      .default(500 * 1024 * 1024),
    FILE_MAX_SIZE_DOCUMENT: z.coerce
      .number()
      .int()
      .positive()
      .default(50 * 1024 * 1024),

    VIDEO_PROVIDER: z.enum(['kinescope', 'mock']).default('mock'),
    KINESCOPE_API_KEY: z.string().default(''),
    KINESCOPE_PARENT_ID: z.string().default(''),
    VIDEO_PLAYBACK_TTL_SEC: z.coerce.number().int().positive().default(7200),

    SENTRY_DSN: z.string().default(''),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

    BACKUP_S3_BUCKET: z.string().default(''),
    BACKUP_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  })
  .superRefine((env, ctx) => {
    const isProdLike = env.APP_ENV === 'staging' || env.APP_ENV === 'production';

    if (env.TELEGRAM_ENABLED) {
      for (const key of [
        'TELEGRAM_BOT_TOKEN',
        'TELEGRAM_BOT_USERNAME',
        'TELEGRAM_WEBHOOK_SECRET',
      ] as const) {
        if (!env[key]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${key} обязателен при TELEGRAM_ENABLED=true`,
          });
        }
      }
    }

    if (env.STORAGE_DRIVER === 's3') {
      for (const key of ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY', 'S3_SECRET_KEY'] as const) {
        if (!env[key]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${key} обязателен при STORAGE_DRIVER=s3`,
          });
        }
      }
    }

    if (env.VIDEO_PROVIDER === 'kinescope' && !env.KINESCOPE_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['KINESCOPE_API_KEY'],
        message: 'KINESCOPE_API_KEY обязателен при VIDEO_PROVIDER=kinescope',
      });
    }

    if (isProdLike) {
      if (env.STORAGE_DRIVER === 'local') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['STORAGE_DRIVER'],
          message: 'STORAGE_DRIVER=local запрещён на staging и production',
        });
      }
      if (env.VIDEO_PROVIDER === 'mock') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['VIDEO_PROVIDER'],
          message: 'VIDEO_PROVIDER=mock запрещён на staging и production',
        });
      }
      if (!env.TELEGRAM_ENABLED) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['TELEGRAM_ENABLED'],
          message: 'TELEGRAM_ENABLED должен быть true на staging и production',
        });
      }
      if (env.SESSION_JWT_SECRET.startsWith('change-me')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['SESSION_JWT_SECRET'],
          message: 'SESSION_JWT_SECRET должен быть заменён на реальный секрет',
        });
      }
    }
  });

export type AppEnv = z.infer<typeof envSchema>;
