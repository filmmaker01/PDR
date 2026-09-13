import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { zodBody } from '@/common/pipes/zod-validation.pipe';
import { Audited } from '@/modules/audit/audit.interceptor';
import { AllowExpiredAccess, Can, Workspace } from '@/modules/workspaces/guards/workspace.guard';
import { Ws } from '@/modules/workspaces/decorators/workspace.decorators';
import type { WorkspaceContext } from '@/modules/workspaces/workspace.types';
import { ClientsService } from './clients.service';
import {
  archiveSchema,
  clientListQuerySchema,
  createClientSchema,
  createVehicleSchema,
  updateClientSchema,
  mergeClientsSchema,
  updateVehicleSchema,
} from '../dto/crm.dto';

@ApiTags('crm')
@Controller('workspaces/:workspaceId')
@Workspace()
export class ClientsController {
  constructor(private readonly clients: ClientsService) {}

  @Get('clients')
  @Can('clients.read')
  @AllowExpiredAccess()
  @ApiOperation({ summary: 'Клиенты с поиском по имени, телефону и номеру авто' })
  async list(@Ws() ws: WorkspaceContext, @Query() query: Record<string, string>) {
    const filter = clientListQuerySchema.parse(query);
    const result = await this.clients.list(ws.workspaceId, filter);

    return {
      items: result.items.map((client) => ({
        id: client.id,
        name: client.name,
        phone: client.phone,
        tags: client.tags,
        archivedAt: client.archivedAt?.toISOString() ?? null,
        vehicles: client.vehicles.map((v) => ({
          id: v.id,
          make: v.make,
          model: v.model,
          plate: v.plate,
          year: v.year,
        })),
        createdAt: client.createdAt.toISOString(),
      })),
      nextCursor: result.nextCursor,
    };
  }

  @Post('clients')
  @Can('clients.write')
  @Audited({ entityType: 'client', action: 'create', idFrom: { responseField: 'id' } })
  @ApiOperation({ summary: 'Новый клиент' })
  async create(
    @Ws() ws: WorkspaceContext,
    @Body(zodBody(createClientSchema)) body: Record<string, never>,
  ) {
    const client = await this.clients.create(ws.workspaceId, ws.userId, body as never);
    return { id: client.id, name: client.name, phone: client.phone };
  }

  @Get('clients/:clientId')
  @Can('clients.read')
  @AllowExpiredAccess()
  @ApiOperation({ summary: 'Карточка клиента: авто, история обращений, долг' })
  async card(@Ws() ws: WorkspaceContext, @Param('clientId') clientId: string) {
    const card = await this.clients.card(ws.workspaceId, clientId);
    return {
      id: card.client.id,
      name: card.client.name,
      phone: card.client.phone,
      phoneExtra: card.client.phoneExtra,
      telegramUsername: card.client.telegramUsername,
      source: card.client.source,
      notes: card.client.notes,
      tags: card.client.tags,
      archivedAt: card.client.archivedAt?.toISOString() ?? null,
      anonymizedAt: card.client.anonymizedAt?.toISOString() ?? null,
      debtMinor: Number(card.debtMinor),
      currency: ws.workspace.currency,
      vehicles: card.vehicles.map((v) => ({
        id: v.id,
        make: v.make,
        model: v.model,
        year: v.year,
        color: v.color,
        plate: v.plate,
        vin: v.vin,
      })),
      orders: card.orders.map((order) => ({
        id: order.id,
        number: order.number,
        status: order.status,
        paymentStatus: order.paymentStatus,
        title: order.title,
        agreedTotalMinor: order.agreedTotalMinor === null ? null : Number(order.agreedTotalMinor),
        paidMinor: Number(order.paidMinor),
        vehicle: order.vehicle
          ? {
              id: order.vehicle.id,
              make: order.vehicle.make,
              model: order.vehicle.model,
              plate: order.vehicle.plate,
            }
          : null,
        createdAt: order.createdAt.toISOString(),
      })),
    };
  }

  @Patch('clients/:clientId')
  @Can('clients.write')
  @Audited({ entityType: 'client', idFrom: { param: 'clientId' } })
  @ApiOperation({ summary: 'Изменение клиента' })
  async update(
    @Ws() ws: WorkspaceContext,
    @Param('clientId') clientId: string,
    @Body(zodBody(updateClientSchema)) body: Record<string, never>,
  ) {
    const client = await this.clients.update(ws.workspaceId, clientId, body as never);
    return { id: client.id, name: client.name };
  }

  @Post('clients/:clientId/archive')
  @Can('clients.manage')
  @Audited({ entityType: 'client', action: 'archive', idFrom: { param: 'clientId' } })
  @ApiOperation({ summary: 'Архивирование клиента' })
  async archive(
    @Ws() ws: WorkspaceContext,
    @Param('clientId') clientId: string,
    @Body(zodBody(archiveSchema)) body: { archived: boolean },
  ) {
    const client = await this.clients.archive(ws.workspaceId, clientId, body.archived);
    return { id: client.id, archivedAt: client.archivedAt?.toISOString() ?? null };
  }

  @Get('clients/:clientId/vehicles')
  @Can('clients.read')
  @AllowExpiredAccess()
  @ApiOperation({ summary: 'Автомобили клиента' })
  async vehicles(@Ws() ws: WorkspaceContext, @Param('clientId') clientId: string) {
    const card = await this.clients.card(ws.workspaceId, clientId);
    return card.vehicles;
  }

  @Post('clients/:clientId/vehicles')
  @Can('clients.write')
  @Audited({ entityType: 'vehicle', action: 'create', idFrom: { responseField: 'id' } })
  @ApiOperation({ summary: 'Новый автомобиль клиента' })
  async createVehicle(
    @Ws() ws: WorkspaceContext,
    @Param('clientId') clientId: string,
    @Body(zodBody(createVehicleSchema)) body: Record<string, unknown>,
  ) {
    const vehicle = await this.clients.createVehicle(ws.workspaceId, {
      ...(body as unknown as { make: string; model: string }),
      clientId,
    });
    return { id: vehicle.id, make: vehicle.make, model: vehicle.model, plate: vehicle.plate };
  }

  @Get('vehicles/:vehicleId')
  @Can('clients.read')
  @AllowExpiredAccess()
  @ApiOperation({ summary: 'Автомобиль и история ремонтов' })
  async vehicleCard(@Ws() ws: WorkspaceContext, @Param('vehicleId') vehicleId: string) {
    const card = await this.clients.vehicleCard(ws.workspaceId, vehicleId);
    return {
      id: card.vehicle.id,
      make: card.vehicle.make,
      model: card.vehicle.model,
      year: card.vehicle.year,
      color: card.vehicle.color,
      plate: card.vehicle.plate,
      vin: card.vehicle.vin,
      bodyType: card.vehicle.bodyType,
      notes: card.vehicle.notes,
      archivedAt: card.vehicle.archivedAt?.toISOString() ?? null,
      client: { id: card.client.id, name: card.client.name, phone: card.client.phone },
      orders: card.orders.map((order) => ({
        id: order.id,
        number: order.number,
        status: order.status,
        title: order.title,
        agreedTotalMinor: order.agreedTotalMinor === null ? null : Number(order.agreedTotalMinor),
        paidMinor: Number(order.paidMinor),
        currency: order.currency,
        createdAt: order.createdAt.toISOString(),
        deliveredAt: order.deliveredAt?.toISOString() ?? null,
      })),
    };
  }

  @Patch('vehicles/:vehicleId')
  @Can('clients.write')
  @Audited({ entityType: 'vehicle', idFrom: { param: 'vehicleId' } })
  @ApiOperation({ summary: 'Изменение автомобиля' })
  async updateVehicle(
    @Ws() ws: WorkspaceContext,
    @Param('vehicleId') vehicleId: string,
    @Body(zodBody(updateVehicleSchema)) body: Record<string, never>,
  ) {
    const vehicle = await this.clients.updateVehicle(ws.workspaceId, vehicleId, body as never);
    return { id: vehicle.id, plate: vehicle.plate };
  }

  @Post('clients/:clientId/anonymize')
  @Can('clients.manage')
  @Audited({ entityType: 'client', action: 'anonymize', idFrom: { param: 'clientId' } })
  @ApiOperation({ summary: 'Удаление персональных данных клиента' })
  async anonymize(@Ws() ws: WorkspaceContext, @Param('clientId') clientId: string) {
    const client = await this.clients.anonymize(ws.workspaceId, clientId);
    return { id: client.id, name: client.name, anonymizedAt: client.anonymizedAt?.toISOString() };
  }

  @Post('clients/:clientId/merge')
  @Can('clients.manage')
  @Audited({ entityType: 'client', action: 'merge', idFrom: { param: 'clientId' } })
  @ApiOperation({ summary: 'Объединение дублей клиента' })
  async merge(
    @Ws() ws: WorkspaceContext,
    @Param('clientId') clientId: string,
    @Body(zodBody(mergeClientsSchema)) body: { sourceClientId: string },
  ) {
    return this.clients.merge(ws.workspaceId, clientId, body.sourceClientId);
  }
}
