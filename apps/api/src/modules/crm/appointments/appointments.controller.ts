import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { utcToZonedString } from '@pdr/shared';
import { Idempotent } from '@/common/interceptors/idempotency.interceptor';
import { zodBody } from '@/common/pipes/zod-validation.pipe';
import { Audited } from '@/modules/audit/audit.interceptor';
import { AllowExpiredAccess, Can, Workspace } from '@/modules/workspaces/guards/workspace.guard';
import { Ws } from '@/modules/workspaces/decorators/workspace.decorators';
import type { WorkspaceContext } from '@/modules/workspaces/workspace.types';
import { AppointmentsService } from './appointments.service';
import {
  ALLOWED_APPOINTMENT_TRANSITIONS,
  APPOINTMENT_KIND_LABELS,
  APPOINTMENT_STATUS_LABELS,
} from './appointment-rules';
import type { AppointmentWithRelations } from '../repositories/appointments.repository';
import {
  appointmentRangeQuerySchema,
  appointmentStatusSchema,
  availabilityQuerySchema,
  createAppointmentSchema,
  updateAppointmentSchema,
} from '../dto/crm.dto';

function serialize(
  appointment: AppointmentWithRelations,
  timezone: string,
): Record<string, unknown> {
  const durationMin = Math.round(
    (appointment.endsAt.getTime() - appointment.startsAt.getTime()) / 60_000,
  );
  return {
    id: appointment.id,
    startsAt: appointment.startsAt.toISOString(),
    endsAt: appointment.endsAt.toISOString(),
    // Локальное время мастерской: экран не должен знать про часовые пояса.
    startsAtLocal: utcToZonedString(appointment.startsAt, timezone),
    endsAtLocal: utcToZonedString(appointment.endsAt, timezone),
    durationMin,
    kind: appointment.kind,
    kindLabel: APPOINTMENT_KIND_LABELS[appointment.kind] ?? appointment.kind,
    status: appointment.status,
    statusLabel: APPOINTMENT_STATUS_LABELS[appointment.status],
    allowedTransitions: ALLOWED_APPOINTMENT_TRANSITIONS[appointment.status].map((status) => ({
      status,
      label: APPOINTMENT_STATUS_LABELS[status],
    })),
    allowOverlap: appointment.allowOverlap,
    title: appointment.title,
    note: appointment.note,
    cancelReason: appointment.cancelReason,
    client: appointment.client
      ? {
          id: appointment.client.id,
          name: appointment.client.name,
          phone: appointment.client.phone,
        }
      : null,
    order: appointment.order
      ? {
          id: appointment.order.id,
          number: appointment.order.number,
          title: appointment.order.title,
          status: appointment.order.status,
          vehicle: appointment.order.vehicle
            ? {
                id: appointment.order.vehicle.id,
                make: appointment.order.vehicle.make,
                model: appointment.order.vehicle.model,
                plate: appointment.order.vehicle.plate,
              }
            : null,
        }
      : null,
    assignee: appointment.assignee
      ? {
          id: appointment.assignee.id,
          name:
            appointment.assignee.displayName ??
            [appointment.assignee.user.firstName, appointment.assignee.user.lastName]
              .filter(Boolean)
              .join(' '),
          color: appointment.assignee.color,
        }
      : null,
    createdAt: appointment.createdAt.toISOString(),
  };
}

@ApiTags('crm')
@Controller('workspaces/:workspaceId/appointments')
@Workspace()
export class AppointmentsController {
  constructor(private readonly appointments: AppointmentsService) {}

  @Get()
  @Can('appointments.read')
  @AllowExpiredAccess()
  @ApiOperation({ summary: 'Записи за период (календарь)' })
  async list(@Ws() ws: WorkspaceContext, @Query() query: Record<string, string>) {
    const parsed = appointmentRangeQuerySchema.parse(query);
    const items = await this.appointments.list(ws, {
      from: parsed.from,
      to: parsed.to,
      assigneeMemberId: parsed.assigneeMemberId,
      statuses: parsed.status,
    });
    return {
      timezone: ws.workspace.timezone,
      items: items.map((item) => serialize(item, ws.workspace.timezone)),
    };
  }

  @Get('availability')
  @Can('appointments.read')
  @AllowExpiredAccess()
  @ApiOperation({ summary: 'Свободные слоты исполнителя на день' })
  async availability(@Ws() ws: WorkspaceContext, @Query() query: Record<string, string>) {
    const parsed = availabilityQuerySchema.parse(query);
    return this.appointments.availability(ws, parsed);
  }

  @Post()
  @Can('appointments.write_own')
  @Idempotent()
  @Audited({ entityType: 'appointment', action: 'create', idFrom: { responseField: 'id' } })
  @ApiOperation({ summary: 'Новая запись в календарь' })
  async create(
    @Ws() ws: WorkspaceContext,
    @Body(zodBody(createAppointmentSchema)) body: Record<string, never>,
  ) {
    const created = await this.appointments.create(ws, body as never);
    const full = await this.appointments.getById(ws, created.id);
    return serialize(full, ws.workspace.timezone);
  }

  @Get(':appointmentId')
  @Can('appointments.read')
  @AllowExpiredAccess()
  @ApiOperation({ summary: 'Карточка записи' })
  async get(@Ws() ws: WorkspaceContext, @Param('appointmentId') appointmentId: string) {
    const appointment = await this.appointments.getById(ws, appointmentId);
    return serialize(appointment, ws.workspace.timezone);
  }

  @Patch(':appointmentId')
  @Can('appointments.write_own')
  @Audited({ entityType: 'appointment', idFrom: { param: 'appointmentId' } })
  @ApiOperation({ summary: 'Перенос записи, смена исполнителя и длительности' })
  async update(
    @Ws() ws: WorkspaceContext,
    @Param('appointmentId') appointmentId: string,
    @Body(zodBody(updateAppointmentSchema)) body: Record<string, never>,
  ) {
    await this.appointments.update(ws, appointmentId, body as never);
    const full = await this.appointments.getById(ws, appointmentId);
    return serialize(full, ws.workspace.timezone);
  }

  @Post(':appointmentId/status')
  @Can('appointments.write_own')
  @Audited({
    entityType: 'appointment',
    action: 'status',
    idFrom: { param: 'appointmentId' },
  })
  @ApiOperation({ summary: 'Статус записи: подтверждена, выполнена, отменена, не приехал' })
  async setStatus(
    @Ws() ws: WorkspaceContext,
    @Param('appointmentId') appointmentId: string,
    @Body(zodBody(appointmentStatusSchema)) body: { to: never; reason?: string | null },
  ) {
    await this.appointments.setStatus(ws, appointmentId, body.to, body.reason);
    const full = await this.appointments.getById(ws, appointmentId);
    return serialize(full, ws.workspace.timezone);
  }
}
