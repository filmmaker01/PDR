import { Module } from '@nestjs/common';
import { ClientsRepository } from './repositories/clients.repository';
import { VehiclesRepository } from './repositories/vehicles.repository';
import { OrdersRepository } from './repositories/orders.repository';
import { ClientsService } from './clients/clients.service';
import { OrdersService } from './orders/orders.service';
import { ClientsController } from './clients/clients.controller';
import { OrdersController } from './orders/orders.controller';

@Module({
  controllers: [ClientsController, OrdersController],
  providers: [
    ClientsRepository,
    VehiclesRepository,
    OrdersRepository,
    ClientsService,
    OrdersService,
  ],
  exports: [ClientsService, OrdersService, ClientsRepository, VehiclesRepository, OrdersRepository],
})
export class CrmModule {}
