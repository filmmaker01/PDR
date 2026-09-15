import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger as PinoLogger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { JobRunnerService } from './infra/jobs/job-runner.service';

/**
 * Локальный обработчик фоновых задач.
 *
 * На Vercel очередь разбирает cron-эндпоинт, и этот процесс не запускается.
 * Он остаётся для разработки: делает то же самое, что cron, только в цикле —
 * чтобы локально не поднимать планировщик.
 */
const TICK_INTERVAL_MS = 10_000;
const TICK_BUDGET_MS = 9_000;

async function bootstrapWorker(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
  app.useLogger(app.get(PinoLogger));
  app.enableShutdownHooks();

  const runner = app.get(JobRunnerService);
  const logger = app.get(PinoLogger);
  logger.log('Локальный обработчик задач запущен');

  let stopping = false;

  const loop = async (): Promise<void> => {
    while (!stopping) {
      try {
        await runner.tick(TICK_BUDGET_MS);
      } catch (err) {
        logger.error({ err }, 'Ошибка разбора очереди');
      }
      await new Promise((resolve) => setTimeout(resolve, TICK_INTERVAL_MS));
    }
  };

  const shutdown = async (signal: string): Promise<void> => {
    logger.log(`Получен ${signal}, останавливаю обработчик`);
    stopping = true;
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await loop();
}

void bootstrapWorker();
