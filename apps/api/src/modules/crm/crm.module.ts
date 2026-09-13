import { Module } from '@nestjs/common';
import { ClientsRepository } from './repositories/clients.repository';
import { VehiclesRepository } from './repositories/vehicles.repository';
import { OrdersRepository } from './repositories/orders.repository';
import { AppointmentsRepository } from './repositories/appointments.repository';
import { ClientsService } from './clients/clients.service';
import { OrdersService } from './orders/orders.service';
import { AppointmentsService } from './appointments/appointments.service';
import { ClientsController } from './clients/clients.controller';
import { OrdersController } from './orders/orders.controller';
import { AppointmentsController } from './appointments/appointments.controller';
import { AppointmentRemindersHandler } from './appointments/jobs/appointment-reminders.handler';
import { CrmWiring } from './crm.wiring';

@Module({
  controllers: [ClientsController, OrdersController, AppointmentsController],
  providers: [
    ClientsRepository,
    VehiclesRepository,
    OrdersRepository,
    AppointmentsRepository,
    ClientsService,
    OrdersService,
    AppointmentsService,
    AppointmentRemindersHandler,
    CrmWiring,
  ],
  exports: [
    ClientsService,
    OrdersService,
    AppointmentsService,
    ClientsRepository,
    VehiclesRepository,
    OrdersRepository,
    AppointmentsRepository,
  ],
})
export class CrmModule {}
