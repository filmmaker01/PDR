import { Module } from '@nestjs/common';
import { AdminAccessController } from './admin-access.controller';
import { AdminUsersController } from './admin-users.controller';
import { AdminWorkspacesController } from './admin-workspaces.controller';
import { AdminAuditController } from './admin-audit.controller';
import { AdminDashboardController } from './admin-dashboard.controller';

@Module({
  controllers: [
    AdminDashboardController,
    AdminAccessController,
    AdminUsersController,
    AdminWorkspacesController,
    AdminAuditController,
  ],
})
export class AdminModule {}
