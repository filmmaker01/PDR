import { Injectable } from '@nestjs/common';
import type { Client, Vehicle } from '@prisma/client';
import { isValidVin, normalizePhone, normalizePlate, normalizeVin } from '@pdr/shared';
import { AppError } from '@/common/errors/app.error';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { ClientsRepository } from '../repositories/clients.repository';
import { VehiclesRepository } from '../repositories/vehicles.repository';
import { OrdersRepository } from '../repositories/orders.repository';

export interface CreateClientInput {
  name: string;
  phone?: string | null;
  phoneExtra?: string | null;
  telegramUsername?: string | null;
  source?: string | null;
  notes?: string | null;
  tags?: string[];
}

export interface CreateVehicleInput {
  clientId: string;
  make: string;
  model: string;
  year?: number | null;
  color?: string | null;
  plate?: string | null;
  vin?: string | null;
  bodyType?: string | null;
  notes?: string | null;
}

@Injectable()
export class ClientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clients: ClientsRepository,
    private readonly vehicles: VehiclesRepository,
    private readonly orders: OrdersRepository,
  ) {}

  async list(
    workspaceId: string,
    filter: { q?: string; archived?: boolean; limit: number; cursor?: string },
  ) {
    return this.clients.list(workspaceId, filter);
  }

  async getById(workspaceId: string, clientId: string): Promise<Client> {
    const client = await this.clients.findById(workspaceId, clientId);
    if (!client) throw AppError.notFound('Клиент не найден');
    return client;
  }

  async create(workspaceId: string, userId: string, input: CreateClientInput): Promise<Client> {
    const phone = this.normalizeOptionalPhone(input.phone);
    return this.clients.create(workspaceId, {
      workspaceId,
      name: input.name.trim(),
      phone,
      phoneExtra: this.normalizeOptionalPhone(input.phoneExtra),
      telegramUsername: input.telegramUsername?.replace(/^@/, '') ?? null,
      source: input.source ?? null,
      notes: input.notes ?? null,
      tags: input.tags ?? [],
      createdById: userId,
    });
  }

  async update(
    workspaceId: string,
    clientId: string,
    input: Partial<CreateClientInput>,
  ): Promise<Client> {
    const client = await this.getById(workspaceId, clientId);
    if (client.anonymizedAt) {
      throw AppError.conflict('Персональные данные клиента удалены, карточку изменить нельзя');
    }

    return this.clients.update(workspaceId, clientId, {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.phone !== undefined ? { phone: this.normalizeOptionalPhone(input.phone) } : {}),
      ...(input.phoneExtra !== undefined
        ? { phoneExtra: this.normalizeOptionalPhone(input.phoneExtra) }
        : {}),
      ...(input.telegramUsername !== undefined
        ? { telegramUsername: input.telegramUsername?.replace(/^@/, '') ?? null }
        : {}),
      ...(input.source !== undefined ? { source: input.source } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...(input.tags !== undefined ? { tags: input.tags } : {}),
    });
  }

  async archive(workspaceId: string, clientId: string, archived: boolean): Promise<Client> {
    await this.getById(workspaceId, clientId);
    return this.clients.update(workspaceId, clientId, {
      archivedAt: archived ? new Date() : null,
    });
  }

  /** Карточка клиента: контакты, автомобили, история обращений, долг. */
  async card(workspaceId: string, clientId: string) {
    const client = await this.getById(workspaceId, clientId);
    const vehicles = await this.vehicles.listByClient(workspaceId, clientId);
    const orders = await this.orders.clientOrders(workspaceId, clientId);
    const debtMinor = await this.clients.debtMinor(workspaceId, clientId);

    return { client, vehicles, orders, debtMinor };
  }

  // ── Автомобили ─────────────────────────────────────────────────────────────

  /**
   * Обезличивание клиента: персональные данные стираются, а заказы, сметы
   * и оплаты остаются — это финансовые записи, и удалять их нельзя.
   */
  async anonymize(workspaceId: string, clientId: string): Promise<Client> {
    const client = await this.getById(workspaceId, clientId);
    if (client.anonymizedAt) return client;

    return this.prisma.transaction(async (tx) => {
      const updated = await tx.client.update({
        where: { id: clientId },
        data: {
          name: `Клиент №${client.id.slice(0, 8)}`,
          phone: null,
          phoneExtra: null,
          telegramUsername: null,
          telegramUserId: null,
          notes: null,
          source: null,
          tags: [],
          anonymizedAt: new Date(),
          archivedAt: client.archivedAt ?? new Date(),
        },
      });

      // Номера и VIN — тоже персональные данные: по ним находят владельца.
      await tx.vehicle.updateMany({
        where: { workspaceId, clientId },
        data: { plate: null, vin: null, notes: null },
      });

      return updated;
    });
  }

  /**
   * Объединение дублей: всё переносится на основного клиента,
   * второй архивируется. Сливаем только внутри одной мастерской.
   */
  async merge(
    workspaceId: string,
    targetId: string,
    sourceId: string,
  ): Promise<{ movedVehicles: number; movedOrders: number; movedAppointments: number }> {
    if (targetId === sourceId) throw AppError.validation('Выберите двух разных клиентов');

    const [target, source] = await Promise.all([
      this.getById(workspaceId, targetId),
      this.getById(workspaceId, sourceId),
    ]);

    return this.prisma.transaction(async (tx) => {
      const movedVehicles = await tx.vehicle.updateMany({
        where: { workspaceId, clientId: source.id },
        data: { clientId: target.id },
      });
      const movedOrders = await tx.order.updateMany({
        where: { workspaceId, clientId: source.id },
        data: { clientId: target.id },
      });
      const movedAppointments = await tx.appointment.updateMany({
        where: { workspaceId, clientId: source.id },
        data: { clientId: target.id },
      });

      await tx.client.update({
        where: { id: target.id },
        data: {
          // Недостающие контакты берём из дубля: объединение не должно терять данные.
          phone: target.phone ?? source.phone,
          phoneExtra: target.phoneExtra ?? source.phone ?? source.phoneExtra,
          telegramUsername: target.telegramUsername ?? source.telegramUsername,
          source: target.source ?? source.source,
          notes: [target.notes, source.notes].filter(Boolean).join('\n') || null,
          tags: [...new Set([...target.tags, ...source.tags])],
        },
      });

      await tx.client.update({
        where: { id: source.id },
        data: { archivedAt: new Date(), notes: `Объединён с клиентом ${target.id}` },
      });

      return {
        movedVehicles: movedVehicles.count,
        movedOrders: movedOrders.count,
        movedAppointments: movedAppointments.count,
      };
    });
  }

  async createVehicle(workspaceId: string, input: CreateVehicleInput): Promise<Vehicle> {
    await this.getById(workspaceId, input.clientId);

    const vin = normalizeVin(input.vin ?? null);
    if (vin && !isValidVin(vin)) {
      throw AppError.validation('VIN должен содержать 17 символов без букв I, O и Q');
    }

    return this.vehicles.create(workspaceId, {
      workspaceId,
      clientId: input.clientId,
      make: input.make.trim(),
      model: input.model.trim(),
      year: input.year ?? null,
      color: input.color ?? null,
      plate: normalizePlate(input.plate ?? null),
      vin,
      bodyType: input.bodyType ?? null,
      notes: input.notes ?? null,
    });
  }

  async getVehicle(workspaceId: string, vehicleId: string): Promise<Vehicle> {
    const vehicle = await this.vehicles.findById(workspaceId, vehicleId);
    if (!vehicle) throw AppError.notFound('Автомобиль не найден');
    return vehicle;
  }

  async updateVehicle(
    workspaceId: string,
    vehicleId: string,
    input: Partial<Omit<CreateVehicleInput, 'clientId'>> & { archived?: boolean },
  ): Promise<Vehicle> {
    await this.getVehicle(workspaceId, vehicleId);

    const vin = input.vin !== undefined ? normalizeVin(input.vin) : undefined;
    if (vin && !isValidVin(vin)) {
      throw AppError.validation('VIN должен содержать 17 символов без букв I, O и Q');
    }

    return this.vehicles.update(workspaceId, vehicleId, {
      ...(input.make !== undefined ? { make: input.make.trim() } : {}),
      ...(input.model !== undefined ? { model: input.model.trim() } : {}),
      ...(input.year !== undefined ? { year: input.year } : {}),
      ...(input.color !== undefined ? { color: input.color } : {}),
      ...(input.plate !== undefined ? { plate: normalizePlate(input.plate) } : {}),
      ...(vin !== undefined ? { vin } : {}),
      ...(input.bodyType !== undefined ? { bodyType: input.bodyType } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...(input.archived !== undefined ? { archivedAt: input.archived ? new Date() : null } : {}),
    });
  }

  async vehicleCard(workspaceId: string, vehicleId: string) {
    const vehicle = await this.getVehicle(workspaceId, vehicleId);
    const client = await this.getById(workspaceId, vehicle.clientId);
    const orders = await this.vehicles.orderHistory(workspaceId, vehicleId);
    return { vehicle, client, orders };
  }

  private normalizeOptionalPhone(value: string | null | undefined): string | null {
    if (value === undefined || value === null || value.trim() === '') return null;
    const normalized = normalizePhone(value);
    if (!normalized) throw AppError.validation('Не удалось разобрать номер телефона');
    return normalized;
  }
}
