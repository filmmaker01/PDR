import { Global, Module } from '@nestjs/common';
import { AccessService } from './access.service';
import { AccessExpireHandler } from './jobs/access-expire.handler';

@Global()
@Module({
  providers: [AccessService, AccessExpireHandler],
  exports: [AccessService],
})
export class AccessModule {}
