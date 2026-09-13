import { Global, Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { JobsService } from './jobs.service';
import { WorkerService } from './worker.service';

@Global()
@Module({
  imports: [DiscoveryModule],
  providers: [JobsService, WorkerService],
  exports: [JobsService, WorkerService],
})
export class JobsModule {}
