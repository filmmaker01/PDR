import { Global, Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsSendHandler } from './jobs/notifications-send.handler';

@Global()
@Module({
  providers: [NotificationsService, NotificationsSendHandler],
  exports: [NotificationsService],
})
export class NotificationsModule {}
