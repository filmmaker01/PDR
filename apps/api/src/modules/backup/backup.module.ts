import { Global, Module } from '@nestjs/common';
import { BackupService } from './backup.service';
import { BackupVerifyHandler } from './jobs/backup-verify.handler';

@Global()
@Module({
  providers: [BackupService, BackupVerifyHandler],
  exports: [BackupService],
})
export class BackupModule {}
