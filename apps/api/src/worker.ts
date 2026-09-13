import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger as PinoLogger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { WorkerService } from './infra/jobs/worker.service';

/**
 * Отдельный процесс фоновых задач. Использует тот же AppModule,
 * поэтому бизнес-логика в API и worker гарантированно одна и та же.
 */
async function bootstrapWorker(): Promise<void> {
  process.env.WORKER_ROLE = 'true';
  const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
  app.useLogger(app.get(PinoLogger));
  app.enableShutdownHooks();

  const worker = app.get(WorkerService);
  const logger = app.get(PinoLogger);
  logger.log('Worker инициализирован');

  const shutdown = async (signal: string): Promise<void> => {
    logger.log(`Получен ${signal}, останавливаю worker`);
    worker.stop();
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

void bootstrapWorker();
