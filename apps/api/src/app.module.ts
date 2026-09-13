import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import { AppConfigModule } from './config/config.module';
import { getEnv } from './config/config.service';
import { PrismaModule } from './infra/prisma/prisma.module';
import { JobsModule } from './infra/jobs/jobs.module';
import { RequestIdMiddleware } from './common/interceptors/request-id.middleware';
import { HealthModule } from './modules/health/health.module';

const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.body.initData',
  'req.body.refreshToken',
  'req.body.hash',
  'req.body.phone',
  'res.headers["set-cookie"]',
];

@Module({
  imports: [
    AppConfigModule,
    LoggerModule.forRoot({
      pinoHttp: {
        level: getEnv().LOG_LEVEL,
        genReqId: (req, res) => {
          const existing = (req.headers['x-request-id'] as string | undefined) ?? randomUUID();
          res.setHeader('X-Request-Id', existing);
          return existing;
        },
        redact: { paths: REDACT_PATHS, censor: '[скрыто]' },
        autoLogging: { ignore: (req) => req.url === '/v1/health' || req.url === '/health' },
        transport:
          getEnv().APP_ENV === 'local'
            ? { target: 'pino-pretty', options: { singleLine: true, translateTime: 'HH:MM:ss' } }
            : undefined,
      },
    }),
    PrismaModule,
    JobsModule,
    HealthModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
