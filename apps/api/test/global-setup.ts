import { execSync } from 'node:child_process';

/**
 * Готовит тестовую базу один раз на весь прогон.
 * Используется реальная PostgreSQL: поведение ограничений и транзакций
 * должно проверяться на настоящей СУБД, а не на заглушке.
 */
export default function globalSetup(): void {
  const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url)
    throw new Error('TEST_DATABASE_URL или DATABASE_URL обязателен для интеграционных тестов');
  process.env.DATABASE_URL = url;

  execSync('prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: url },
  });
}
