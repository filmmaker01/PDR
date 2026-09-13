import { Global, Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';
import { SessionGuard } from './guards/session.guard';
import { PlatformRoleGuard } from './guards/platform-role.guard';
import { SessionsCleanupHandler } from './jobs/sessions-cleanup.handler';
import { IdempotencyCleanupHandler } from './jobs/idempotency-cleanup.handler';

@Global()
@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    SessionService,
    SessionGuard,
    PlatformRoleGuard,
    SessionsCleanupHandler,
    IdempotencyCleanupHandler,
  ],
  exports: [AuthService, SessionService, SessionGuard, PlatformRoleGuard],
})
export class AuthModule {}
