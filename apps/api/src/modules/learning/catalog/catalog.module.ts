import { Global, Module } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { CourseEditorService } from './course-editor.service';
import { VideoService } from './video.service';
import { AdminCatalogController } from './admin-catalog.controller';
import { VideoPollHandler } from './jobs/video-poll.handler';

@Global()
@Module({
  controllers: [AdminCatalogController],
  providers: [CatalogService, CourseEditorService, VideoService, VideoPollHandler],
  exports: [CatalogService, CourseEditorService, VideoService],
})
export class CatalogModule {}
