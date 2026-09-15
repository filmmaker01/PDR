import { Logger as PinoLogger } from 'nestjs-pino';
import { createApp } from './bootstrap';
import { AppConfigService } from './config/config.service';

/**
 * Запуск обычным процессом: локальная разработка и тесты.
 * На Vercel точка входа другая — `api/index.ts`.
 */
async function bootstrap(): Promise<void> {
  const { app } = await createApp();
  const config = app.get(AppConfigService);

  app.enableShutdownHooks();

  await app.listen(config.env.PORT, '0.0.0.0');
  app.get(PinoLogger).log(`API запущен на порту ${config.env.PORT} (${config.env.APP_ENV})`);
}

void bootstrap();
