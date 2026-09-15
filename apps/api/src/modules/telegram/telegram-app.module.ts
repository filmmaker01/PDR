import { Module } from '@nestjs/common';
import { ClubModule } from '@/modules/club/club.module';
import { TelegramController } from './telegram.controller';
import { TelegramSetupController } from './telegram-setup.controller';
import { TelegramUpdateService } from './telegram-update.service';

@Module({
  imports: [ClubModule],
  controllers: [TelegramController, TelegramSetupController],
  providers: [TelegramUpdateService],
  exports: [TelegramUpdateService],
})
export class TelegramAppModule {}
