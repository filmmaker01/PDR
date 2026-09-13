import { Module } from '@nestjs/common';
import { ExportService } from './export.service';
import { ExportBuilderService } from './export-builder.service';
import { AdminExportController, WorkspaceExportController } from './export.controller';
import { ExportRunHandler } from './jobs/export-run.handler';
import { ExportCleanupHandler } from './jobs/export-cleanup.handler';

@Module({
  controllers: [WorkspaceExportController, AdminExportController],
  providers: [ExportService, ExportBuilderService, ExportRunHandler, ExportCleanupHandler],
  exports: [ExportService],
})
export class ExportModule {}
