import { Module } from '@nestjs/common';
import { TelegramController } from './telegram.controller';
import { TelegramUpdateService } from './telegram-update.service';

@Module({
  controllers: [TelegramController],
  providers: [TelegramUpdateService],
  exports: [TelegramUpdateService],
})
export class TelegramAppModule {}
