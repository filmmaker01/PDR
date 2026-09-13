import { Module } from '@nestjs/common';
import { ClubService } from './club.service';
import { ClubController } from './club.controller';
import { ClubAdminController } from './club-admin.controller';
import { ClubApproveHandler } from './jobs/club-approve.handler';
import { ClubRemoveHandler } from './jobs/club-remove.handler';
import { ClubAuditHandler } from './jobs/club-audit.handler';

@Module({
  controllers: [ClubController, ClubAdminController],
  providers: [ClubService, ClubApproveHandler, ClubRemoveHandler, ClubAuditHandler],
  exports: [ClubService],
})
export class ClubModule {}
