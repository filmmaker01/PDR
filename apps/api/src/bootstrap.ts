import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger as PinoLogger } from 'nestjs-pino';
import express, { type Express } from 'express';
import helmet from 'helmet';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from './app.module';
import { AppConfigService } from './config/config.service';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

/**
 * Сборка и настройка приложения без запуска слушателя.
 *
 * Вынесено из `main.ts`, потому что точек входа теперь две: обычный процесс
 * (локальная разработка) и функция Vercel. Настройка у них обязана совпадать,
 * поэтому она описана здесь один раз.
 */
export async function createApp(): Promise<{ app: INestApplication; server: Express }> {
  const server = express();
  const app = await NestFactory.create(AppModule, new ExpressAdapter(server), {
    bufferLogs: true,
  });
  const config = app.get(AppConfigService);

  app.useLogger(app.get(PinoLogger));
  app.setGlobalPrefix('v1', { exclude: ['health', 'health/ready'] });

  // Mini App живёт внутри WebView Telegram: X-Frame-Options ломает встраивание,
  // поэтому фреймовую политику задаёт CSP на стороне фронтендов.
  app.use(
    helmet({
      frameguard: false,
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  app.enableCors({
    origin: config.corsOrigins,
    credentials: true,
    // X-File-Name нужен загрузке видео из админки: без него preflight режет
    // запрос, и файл не уходит.
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Idempotency-Key',
      'X-Request-Id',
      'X-File-Name',
    ],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 86_400,
  });

  app.useGlobalFilters(new AllExceptionsFilter(!config.isProdLike));

  if (!config.isProduction) {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('PDR Platform API')
        .setDescription('Обучение, CRM и платформа для PDR-мастеров')
        .setVersion('1.0')
        .addBearerAuth()
        .build(),
    );
    SwaggerModule.setup('docs', app, doc, { jsonDocumentUrl: 'docs/openapi.json' });
  }

  return { app, server };
}
