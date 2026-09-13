import { Global, Module } from '@nestjs/common';
import { ClubModule } from '@/modules/club/club.module';
import { AccessService } from './access.service';
import { AccessExpireHandler } from './jobs/access-expire.handler';

@Global()
@Module({
  imports: [ClubModule],
  providers: [AccessService, AccessExpireHandler],
  exports: [AccessService],
})
export class AccessModule {}
