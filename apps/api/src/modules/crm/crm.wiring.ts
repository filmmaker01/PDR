import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { OrdersService } from './orders/orders.service';
import { AppointmentsService } from './appointments/appointments.service';

/**
 * Связка модулей CRM между собой.
 *
 * Заказы не знают про календарь, а календарь не знает про переходы статусов:
 * подписка живёт здесь, поэтому ни один из сервисов не зависит от другого
 * в обе стороны.
 */
@Injectable()
export class CrmWiring implements OnModuleInit {
  private readonly logger = new Logger(CrmWiring.name);

  constructor(
    private readonly orders: OrdersService,
    private readonly appointments: AppointmentsService,
  ) {}

  onModuleInit(): void {
    this.orders.onTransition(async (event) => {
      if (event.to !== 'cancelled') return;
      const cancelled = await this.appointments.cancelFutureForOrder(
        event.workspaceId,
        event.orderId,
        'Заказ отменён',
        event.tx,
      );
      if (cancelled > 0) {
        this.logger.log(
          { orderId: event.orderId, cancelled },
          'Будущие записи отменённого заказа сняты',
        );
      }
    });
  }
}
