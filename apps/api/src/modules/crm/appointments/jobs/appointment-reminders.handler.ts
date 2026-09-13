import { Injectable, Logger } from '@nestjs/common';
import { utcToZonedString } from '@pdr/shared';
import { JobHandler } from '@/infra/jobs/job-handler';
import { JOB } from '@/infra/jobs/job-queue';
import { NotificationsService } from '@/modules/notifications/notifications.service';
import { DEFAULT_WORKSPACE_SETTINGS } from '@/modules/workspaces/workspace.types';
import { AppointmentsRepository } from '../../repositories/appointments.repository';

/** Максимальное упреждение напоминания: больше суток напоминать бессмысленно. */
const MAX_LEAD_MINUTES = 1440;

/**
 * Напоминания о ближайших записях.
 *
 * Задача периодическая, а не отложенная на момент записи: перенос и отмена
 * иначе оставляли бы в очереди напоминание о времени, которого уже нет.
 * Ключ дедупликации содержит время начала, поэтому перенос записи даёт
 * новое напоминание, а повторный запуск задачи — нет.
 */
@Injectable()
export class AppointmentRemindersHandler extends JobHandler<
  typeof JOB.appointmentsScheduleReminders
> {
  readonly jobName = JOB.appointmentsScheduleReminders;
  override readonly cron = '*/5 * * * *';
  private readonly logger = new Logger(AppointmentRemindersHandler.name);

  constructor(
    private readonly appointments: AppointmentsRepository,
    private readonly notifications: NotificationsService,
  ) {
    super();
  }

  async handle(): Promise<void> {
    const now = new Date();
    const horizon = new Date(now.getTime() + MAX_LEAD_MINUTES * 60_000);
    const upcoming = await this.appointments.dueForReminder(now, horizon);

    let queued = 0;
    for (const appointment of upcoming) {
      const settings = {
        ...DEFAULT_WORKSPACE_SETTINGS,
        ...((appointment.workspace.settings as Record<string, unknown> | null) ?? {}),
      };
      const lead = Math.min(
        Math.max(Number(settings.reminder_lead_minutes) || 0, 0),
        MAX_LEAD_MINUTES,
      );
      if (lead === 0) continue;

      const minutesLeft = Math.round((appointment.startsAt.getTime() - now.getTime()) / 60_000);
      if (minutesLeft > lead) continue;
      if (!appointment.assignee) continue;

      const created = await this.notifications.notify({
        userId: appointment.assignee.userId,
        type: 'appointment_reminder',
        payload: {
          minutes: Math.max(minutesLeft, 0),
          time: utcToZonedString(appointment.startsAt, appointment.workspace.timezone).slice(11, 16),
          clientName: appointment.client?.name ?? appointment.title ?? 'Без клиента',
          vehicle: appointment.order?.vehicle
            ? `${appointment.order.vehicle.make} ${appointment.order.vehicle.model}`
            : null,
          workspaceId: appointment.workspaceId,
          orderId: appointment.order?.id ?? null,
          appointmentId: appointment.id,
        },
        // Перенос записи меняет ключ: о новом времени напомним заново.
        dedupeKey: `appointment_reminder:${appointment.id}:${appointment.startsAt.toISOString()}`,
      });
      if (created) queued += 1;
    }

    if (queued > 0) this.logger.log(`Поставлено напоминаний о записях: ${queued}`);
  }
}
