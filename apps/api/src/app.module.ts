import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import { AppConfigModule } from './config/config.module';
import { getEnv } from './config/config.service';
import { PrismaModule } from './infra/prisma/prisma.module';
import { JobsModule } from './infra/jobs/jobs.module';
import { TelegramModule } from './infra/telegram/telegram.module';
import { StorageModule } from './infra/storage/storage.module';
import { VideoModule } from './infra/video/video.module';
import { AiModule } from './infra/ai/ai.module';
import { RequestIdMiddleware } from './common/interceptors/request-id.middleware';
import { IdempotencyInterceptor } from './common/interceptors/idempotency.interceptor';
import { RateLimitGuard } from './common/guards/rate-limit.guard';
import { HealthModule } from './modules/health/health.module';
import { UsersModule } from './modules/users/users.module';
import { AuthModule } from './modules/auth/auth.module';
import { SessionGuard } from './modules/auth/guards/session.guard';
import { PlatformRoleGuard } from './modules/auth/guards/platform-role.guard';
import { MeModule } from './modules/me/me.module';
import { AccessModule } from './modules/access/access.module';
import { WorkspacesModule } from './modules/workspaces/workspaces.module';
import { WorkspaceGuard } from './modules/workspaces/guards/workspace.guard';
import { AdminModule } from './modules/admin/admin.module';
import { FilesModule } from './modules/files/files.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuditInterceptor } from './modules/audit/audit.interceptor';
import { CatalogModule } from './modules/learning/catalog/catalog.module';
import { LearningModule } from './modules/learning/learning.module';
import { VideoAccessModule } from './modules/learning/video-access/video-access.module';
import { AssignmentsModule } from './modules/learning/assignments/assignments.module';
import { ExamsModule } from './modules/learning/exams/exams.module';
import { CrmModule } from './modules/crm/crm.module';
import { TelegramAppModule } from './modules/telegram/telegram-app.module';
import { ClubModule } from './modules/club/club.module';
import { ExportModule } from './modules/export/export.module';
import { BackupModule } from './modules/backup/backup.module';

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
    TelegramModule,
    StorageModule,
    VideoModule,
    AiModule,
    UsersModule,
    AuthModule,
    AccessModule,
    WorkspacesModule,
    FilesModule,
    NotificationsModule,
    AuditModule,
    CatalogModule,
    LearningModule,
    VideoAccessModule,
    AssignmentsModule,
    ExamsModule,
    CrmModule,
    ClubModule,
    ExportModule,
    BackupModule,
    HealthModule,
    MeModule,
    AdminModule,
    TelegramAppModule,
  ],
  providers: [
    // Порядок важен: сессия → роль платформы → ограничение частоты.
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_GUARD, useClass: PlatformRoleGuard },
    { provide: APP_GUARD, useClass: WorkspaceGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
