import { Global, Module } from '@nestjs/common';
import { WorkspacesService } from './workspaces.service';
import { InvitationsService } from './invitations.service';
import { WorkspacesController } from './workspaces.controller';
import { InvitationsController } from './invitations.controller';
import { WorkspaceGuard } from './guards/workspace.guard';

@Global()
@Module({
  controllers: [WorkspacesController, InvitationsController],
  providers: [WorkspacesService, InvitationsService, WorkspaceGuard],
  exports: [WorkspacesService, InvitationsService, WorkspaceGuard],
})
export class WorkspacesModule {}
