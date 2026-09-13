import { Injectable } from '@nestjs/common';
import type { Prisma, Vehicle } from '@prisma/client';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { WorkspaceScopedRepository } from '@/modules/workspaces/repositories/workspace-scoped.repository';

@Injectable()
export class VehiclesRepository extends WorkspaceScopedRepository {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  async findById(workspaceId: string, vehicleId: string): Promise<Vehicle | null> {
    return this.prisma.vehicle.findFirst({ where: { id: vehicleId, workspaceId } });
  }

  async listByClient(workspaceId: string, clientId: string): Promise<Vehicle[]> {
    return this.prisma.vehicle.findMany({
      where: { workspaceId, clientId, archivedAt: null },
      orderBy: { createdAt: 'asc' },
    });
  }

  async search(workspaceId: string, plate: string): Promise<Vehicle[]> {
    return this.prisma.vehicle.findMany({
      where: { workspaceId, plate: { contains: plate.toUpperCase() }, archivedAt: null },
      take: 20,
    });
  }

  async create(workspaceId: string, data: Prisma.VehicleUncheckedCreateInput): Promise<Vehicle> {
    return this.prisma.vehicle.create({ data: { ...data, workspaceId } });
  }

  async update(
    workspaceId: string,
    vehicleId: string,
    data: Prisma.VehicleUncheckedUpdateInput,
  ): Promise<Vehicle> {
    const vehicle = await this.findById(workspaceId, vehicleId);
    this.assertOwned(vehicle, workspaceId, 'Автомобиль не найден');
    const { workspaceId: _ignored, id: _id, ...safe } = data;
    void _ignored;
    void _id;
    return this.prisma.vehicle.update({ where: { id: vehicleId }, data: safe });
  }

  async orderHistory(workspaceId: string, vehicleId: string) {
    return this.prisma.order.findMany({
      where: { workspaceId, vehicleId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        number: true,
        status: true,
        title: true,
        agreedTotalMinor: true,
        paidMinor: true,
        currency: true,
        createdAt: true,
        deliveredAt: true,
      },
    });
  }
}
