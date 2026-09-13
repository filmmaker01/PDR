import { Global, Module } from '@nestjs/common';
import { StageAccessService } from './progress/stage-access.service';
import { ProgressService } from './progress/progress.service';
import { CompletionFactsRegistry } from './progress/completion-facts.registry';
import { CohortsService } from './cohorts/cohorts.service';
import { AdminCohortsController } from './cohorts/admin-cohorts.controller';
import { LearningService } from './student/learning.service';
import { LearningController } from './student/learning.controller';
import { UnlockByDateHandler } from './progress/jobs/unlock-by-date.handler';

@Global()
@Module({
  controllers: [LearningController, AdminCohortsController],
  providers: [
    StageAccessService,
    ProgressService,
    CompletionFactsRegistry,
    CohortsService,
    LearningService,
    UnlockByDateHandler,
  ],
  exports: [
    StageAccessService,
    ProgressService,
    CompletionFactsRegistry,
    CohortsService,
    LearningService,
  ],
})
export class LearningModule {}
