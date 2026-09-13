import { Injectable } from '@nestjs/common';
import { JobHandler } from '@/infra/jobs/job-handler';
import { JOB } from '@/infra/jobs/job-queue';
import { NotificationsService } from '../notifications.service';

/**
 * Отправка уведомления. Повторяется очередью при сетевых ошибках и 429.
 * Блокировка бота и отключённые настройки не считаются ошибкой.
 */
@Injectable()
export class NotificationsSendHandler extends JobHandler<typeof JOB.notificationsSend> {
  readonly jobName = JOB.notificationsSend;
  override readonly batchSize = 5;

  constructor(private readonly notifications: NotificationsService) {
    super();
  }

  async handle(payload: { notificationId: string }): Promise<void> {
    await this.notifications.send(payload.notificationId);
  }
}
