import { describe, expect, it } from 'vitest';
import { loadEnv } from './config.service';

const base = {
  PUBLIC_API_URL: 'http://localhost:3000',
  MINIAPP_URL: 'http://localhost:5173',
  ADMIN_URL: 'http://localhost:5174',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  SESSION_JWT_SECRET: 'a'.repeat(32),
};

describe('env schema', () => {
  it('accepts a minimal local config', () => {
    const env = loadEnv({ ...base } as NodeJS.ProcessEnv);
    expect(env.APP_ENV).toBe('local');
    expect(env.STORAGE_DRIVER).toBe('local');
    expect(env.TELEGRAM_ENABLED).toBe(false);
  });

  it('rejects a short session secret', () => {
    expect(() => loadEnv({ ...base, SESSION_JWT_SECRET: 'short' } as NodeJS.ProcessEnv)).toThrow(
      /SESSION_JWT_SECRET/,
    );
  });

  it('requires telegram credentials when telegram is enabled', () => {
    expect(() =>
      loadEnv({ ...base, TELEGRAM_ENABLED: 'true' } as unknown as NodeJS.ProcessEnv),
    ).toThrow(/TELEGRAM_BOT_TOKEN/);
  });

  it('requires s3 credentials when driver is s3', () => {
    expect(() =>
      loadEnv({ ...base, STORAGE_DRIVER: 's3' } as unknown as NodeJS.ProcessEnv),
    ).toThrow(/S3_ENDPOINT/);
  });

  it('forbids local storage, mock video and disabled telegram in production', () => {
    const run = (): unknown =>
      loadEnv({
        ...base,
        APP_ENV: 'production',
        SESSION_JWT_SECRET: 'b'.repeat(40),
      } as unknown as NodeJS.ProcessEnv);
    expect(run).toThrow(/STORAGE_DRIVER=local запрещён/);
  });

  it('forbids the placeholder secret in production', () => {
    expect(() =>
      loadEnv({
        ...base,
        APP_ENV: 'production',
        SESSION_JWT_SECRET: 'change-me-to-a-long-random-string-yes',
        STORAGE_DRIVER: 's3',
        S3_ENDPOINT: 'https://s3',
        S3_BUCKET: 'b',
        S3_ACCESS_KEY: 'k',
        S3_SECRET_KEY: 's',
        VIDEO_PROVIDER: 'kinescope',
        KINESCOPE_API_KEY: 'key',
        TELEGRAM_ENABLED: 'true',
        TELEGRAM_BOT_TOKEN: 't',
        TELEGRAM_BOT_USERNAME: 'bot',
        TELEGRAM_WEBHOOK_SECRET: 'w',
      } as unknown as NodeJS.ProcessEnv),
    ).toThrow(/SESSION_JWT_SECRET должен быть заменён/);
  });
});
