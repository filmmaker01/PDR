import { Global, Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { JobRunnerService } from './job-runner.service';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';

@Global()
@Module({
  imports: [DiscoveryModule],
  controllers: [JobsController],
  providers: [JobsService, JobRunnerService],
  exports: [JobsService, JobRunnerService],
})
export class JobsModule {}
