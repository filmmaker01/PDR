import { Injectable } from '@nestjs/common';
import { type AppEnv, envSchema } from './env.schema';

let cached: AppEnv | null = null;

/** Валидирует переменные окружения. Бросает с понятным списком проблем. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Некорректная конфигурация окружения:\n${lines.join('\n')}`);
  }
  return parsed.data;
}

export function getEnv(): AppEnv {
  cached ??= loadEnv();
  return cached;
}

/** Только для тестов. */
export function resetEnvCache(): void {
  cached = null;
}

@Injectable()
export class AppConfigService {
  readonly env: AppEnv = getEnv();

  get isProduction(): boolean {
    return this.env.APP_ENV === 'production';
  }

  get isProdLike(): boolean {
    return this.env.APP_ENV === 'production' || this.env.APP_ENV === 'staging';
  }

  get isTest(): boolean {
    return this.env.APP_ENV === 'test' || this.env.NODE_ENV === 'test';
  }

  get corsOrigins(): string[] {
    const extra = this.env.CORS_EXTRA_ORIGINS.split(',')
      .map((origin) => origin.trim().replace(/\/$/, ''))
      .filter(Boolean);
    return [...new Set([this.env.MINIAPP_URL, this.env.ADMIN_URL, ...extra])].filter(Boolean);
  }
}
