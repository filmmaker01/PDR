import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger as PinoLogger } from 'nestjs-pino';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AppConfigService } from './config/config.service';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
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
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 86_400,
  });

  app.useGlobalFilters(new AllExceptionsFilter(!config.isProdLike));
  app.enableShutdownHooks();

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

  await app.listen(config.env.PORT, '0.0.0.0');
  app.get(PinoLogger).log(`API запущен на порту ${config.env.PORT} (${config.env.APP_ENV})`);
}

void bootstrap();
