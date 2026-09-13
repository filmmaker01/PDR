import { Module } from '@nestjs/common';
import { ClientsRepository } from './repositories/clients.repository';
import { VehiclesRepository } from './repositories/vehicles.repository';
import { OrdersRepository } from './repositories/orders.repository';
import { AppointmentsRepository } from './repositories/appointments.repository';
import { EstimatesRepository } from './repositories/estimates.repository';
import { PriceListRepository } from './repositories/price-list.repository';
import { PaymentsRepository } from './repositories/payments.repository';
import { OrderPhotosRepository } from './repositories/order-photos.repository';
import { AnalyticsRepository } from './repositories/analytics.repository';
import { ClientsService } from './clients/clients.service';
import { OrdersService } from './orders/orders.service';
import { AppointmentsService } from './appointments/appointments.service';
import { EstimatesService } from './estimates/estimates.service';
import { PriceListService } from './estimates/price-list.service';
import { EstimatePdfService } from './estimates/estimate-pdf.service';
import { PaymentsService } from './payments/payments.service';
import { OrderPhotosService } from './photos/order-photos.service';
import { AnalyticsService } from './analytics/analytics.service';
import { ClientsController } from './clients/clients.controller';
import { OrdersController } from './orders/orders.controller';
import { AppointmentsController } from './appointments/appointments.controller';
import { EstimatesController } from './estimates/estimates.controller';
import { PaymentsController } from './payments/payments.controller';
import { OrderPhotosController } from './photos/order-photos.controller';
import { AnalyticsController } from './analytics/analytics.controller';
import { AppointmentRemindersHandler } from './appointments/jobs/appointment-reminders.handler';
import { CrmWiring } from './crm.wiring';

@Module({
  controllers: [
    ClientsController,
    OrdersController,
    AppointmentsController,
    EstimatesController,
    PaymentsController,
    OrderPhotosController,
    AnalyticsController,
  ],
  providers: [
    ClientsRepository,
    VehiclesRepository,
    OrdersRepository,
    AppointmentsRepository,
    EstimatesRepository,
    PriceListRepository,
    PaymentsRepository,
    OrderPhotosRepository,
    AnalyticsRepository,
    ClientsService,
    OrdersService,
    AppointmentsService,
    EstimatesService,
    PriceListService,
    EstimatePdfService,
    PaymentsService,
    OrderPhotosService,
    AnalyticsService,
    AppointmentRemindersHandler,
    CrmWiring,
  ],
  exports: [
    ClientsService,
    OrdersService,
    AppointmentsService,
    EstimatesService,
    PriceListService,
    PaymentsService,
    OrderPhotosService,
    AnalyticsService,
    ClientsRepository,
    VehiclesRepository,
    OrdersRepository,
    AppointmentsRepository,
    EstimatesRepository,
    PriceListRepository,
    PaymentsRepository,
    OrderPhotosRepository,
  ],
})
export class CrmModule {}
