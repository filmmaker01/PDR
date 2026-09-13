import { Module } from '@nestjs/common';
import { AdminAccessController } from './admin-access.controller';
import { AdminUsersController } from './admin-users.controller';
import { AdminWorkspacesController } from './admin-workspaces.controller';

@Module({
  controllers: [AdminAccessController, AdminUsersController, AdminWorkspacesController],
})
export class AdminModule {}
