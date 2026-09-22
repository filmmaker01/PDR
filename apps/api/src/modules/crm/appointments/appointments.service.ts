import { Injectable } from '@nestjs/common';
import type { Appointment, AppointmentKind, AppointmentStatus, Prisma } from '@prisma/client';
import { ownsRecord, zonedTimeToUtc, todayInZone, utcToZonedString } from '@pdr/shared';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { AppError } from '@/common/errors/app.error';
import { WorkspacesService } from '@/modules/workspaces/workspaces.service';
import type { WorkspaceContext } from '@/modules/workspaces/workspace.types';
import { OrdersRepository } from '../repositories/orders.repository';
import {
  AppointmentsRepository,
  type AppointmentWithRelations,
} from '../repositories/appointments.repository';
import {
  ALLOWED_APPOINTMENT_TRANSITIONS,
  APPOINTMENT_STATUS_LABELS,
  canTransitionAppointment,
  isEditable,
  isOwnerOnlyAppointmentTransition,
} from './appointment-rules';
import { availableSlots, parseClock, type TimeRange } from './availability';

const MINUTE = 60_000;
/** Диапазон выборки календаря: больше двух месяцев за запрос не отдаём. */
const MAX_RANGE_DAYS = 62;

export interface CreateAppointmentInput {
  orderId?: string | null;
  /** Запись по обращению: клиента записали ещё до появления заказа. */
  leadId?: string | null;
  clientId?: string | null;
  assigneeMemberId?: string | null;
  /** Локальное время мастерской: `YYYY-MM-DDTHH:mm`. */
  startsAtLocal: string;
  durationMin: number;
  kind?: AppointmentKind;
  title?: string | null;
  note?: string | null;
  allowOverlap?: boolean;
}

export interface UpdateAppointmentInput {
  startsAtLocal?: string;
  durationMin?: number;
  assigneeMemberId?: string | null;
  kind?: AppointmentKind;
  title?: string | null;
  note?: string | null;
  allowOverlap?: boolean;
}

@Injectable()
export class AppointmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly appointments: AppointmentsRepository,
    private readonly orders: OrdersRepository,
    private readonly workspaces: WorkspacesService,
  ) {}

  // ── Чтение ────────────────────────────────────────────────────────────────

  async list(
    ctx: WorkspaceContext,
    filter: { from: Date; to: Date; assigneeMemberId?: string; statuses?: AppointmentStatus[] },
  ): Promise<AppointmentWithRelations[]> {
    if (filter.to <= filter.from) throw AppError.validation('Конец диапазона раньше начала');
    if (filter.to.getTime() - filter.from.getTime() > MAX_RANGE_DAYS * 86_400_000) {
      throw AppError.validation(`Диапазон календаря не может превышать ${MAX_RANGE_DAYS} дней`);
    }
    return this.appointments.listRange(ctx.workspaceId, filter);
  }

  /** День в часовом поясе мастерской. */
  async day(
    ctx: WorkspaceContext,
    dayIso: string,
    assigneeMemberId?: string,
  ): Promise<AppointmentWithRelations[]> {
    const { from, to } = this.dayBounds(ctx, dayIso);
    return this.appointments.listRange(ctx.workspaceId, { from, to, assigneeMemberId });
  }

  /**
   * Сколько записей в каждом дне месяца.
   *
   * Отдельно от списка записей: месячному календарю нужны только индикаторы,
   * и тащить на телефон полные карточки за месяц ради точек под датами — лишний
   * трафик. Дни считаются в часовом поясе мастерской, а не сервера.
   */
  async monthDays(
    ctx: WorkspaceContext,
    month: string,
    assigneeMemberId?: string,
  ): Promise<{
    month: string;
    timezone: string;
    days: { day: string; total: number; active: number }[];
  }> {
    const timezone = ctx.workspace.timezone;
    const [year, monthNo] = month.split('-').map(Number) as [number, number];
    if (!year || !monthNo || monthNo < 1 || monthNo > 12) {
      throw AppError.validation('Ожидается месяц в формате 2026-05');
    }

    const from = zonedTimeToUtc(`${month}-01T00:00:00`, timezone);
    const nextMonth =
      monthNo === 12 ? `${year + 1}-01` : `${year}-${String(monthNo + 1).padStart(2, '0')}`;
    const to = zonedTimeToUtc(`${nextMonth}-01T00:00:00`, timezone);

    const items = await this.appointments.listRange(ctx.workspaceId, {
      from,
      to,
      assigneeMemberId,
    });

    const byDay = new Map<string, { total: number; active: number }>();
    for (const item of items) {
      const day = utcToZonedString(item.startsAt, timezone).slice(0, 10);
      const current = byDay.get(day) ?? { total: 0, active: 0 };
      current.total += 1;
      // Отменённая запись и неявка день не занимают: индикатор «есть записи»
      // должен означать работу, а не историю отмен.
      if (item.status !== 'cancelled' && item.status !== 'no_show') current.active += 1;
      byDay.set(day, current);
    }

    return {
      month,
      timezone,
      days: [...byDay.entries()]
        .map(([day, counts]) => ({ day, ...counts }))
        .sort((a, b) => a.day.localeCompare(b.day)),
    };
  }

  async getById(ctx: WorkspaceContext, id: string): Promise<AppointmentWithRelations> {
    const appointment = await this.appointments.findById(ctx.workspaceId, id);
    if (!appointment) throw AppError.notFound('Запись не найдена');
    return appointment;
  }

  async listForOrder(ctx: WorkspaceContext, orderId: string): Promise<AppointmentWithRelations[]> {
    return this.appointments.listForOrder(ctx.workspaceId, orderId);
  }

  // ── Создание и изменение ──────────────────────────────────────────────────

  async create(ctx: WorkspaceContext, input: CreateAppointmentInput): Promise<Appointment> {
    return this.prisma.transaction(async (tx) => this.createWithin(tx, ctx, input));
  }

  /**
   * Создание внутри существующей транзакции: заказ и первая запись
   * появляются вместе (сценарий «новый заказ с записью»).
   */
  async createWithin(
    tx: Prisma.TransactionClient,
    ctx: WorkspaceContext,
    input: CreateAppointmentInput,
  ): Promise<Appointment> {
    const { startsAt, endsAt } = this.resolveRange(ctx, input.startsAtLocal, input.durationMin);
    const assigneeMemberId = await this.resolveAssignee(ctx, input.assigneeMemberId, tx);
    const allowOverlap = this.resolveAllowOverlap(ctx, input.allowOverlap);

    let clientId = input.clientId ?? null;
    let orderId = input.orderId ?? null;

    if (orderId) {
      const order = await tx.order.findFirst({
        where: { id: orderId, workspaceId: ctx.workspaceId },
        select: { id: true, clientId: true, assigneeMemberId: true, createdById: true },
      });
      if (!order) throw AppError.notFound('Заказ не найден');
      this.assertCanWriteFor(ctx, order);
      clientId = clientId ?? order.clientId;
    } else {
      orderId = null;
    }

    if (clientId) {
      const client = await tx.client.findFirst({
        where: { id: clientId, workspaceId: ctx.workspaceId },
        select: { id: true },
      });
      if (!client) throw AppError.notFound('Клиент не найден');
    }

    if (assigneeMemberId && !allowOverlap) {
      await this.assertNoConflicts(ctx, { assigneeMemberId, startsAt, endsAt }, tx);
    }

    const created = await this.appointments
      .create(
        ctx.workspaceId,
        {
          orderId,
          leadId: input.leadId ?? null,
          clientId,
          assigneeMemberId,
          startsAt,
          endsAt,
          kind: input.kind ?? 'repair',
          status: 'planned',
          allowOverlap,
          title: input.title ?? null,
          note: input.note ?? null,
          createdById: ctx.userId,
        },
        tx,
      )
      .catch((err: unknown) => this.rethrowOverlap(err));

    if (orderId) await this.syncOrderSchedule(ctx.workspaceId, orderId, tx);
    return created;
  }

  async update(
    ctx: WorkspaceContext,
    id: string,
    input: UpdateAppointmentInput,
  ): Promise<Appointment> {
    const existing = await this.getById(ctx, id);
    this.assertCanWrite(ctx, existing);

    if (!isEditable(existing.status)) {
      throw new AppError(
        'invalid_transition',
        `Запись в статусе «${APPOINTMENT_STATUS_LABELS[existing.status]}» переносить нельзя`,
      );
    }

    const durationMin =
      input.durationMin ??
      Math.round((existing.endsAt.getTime() - existing.startsAt.getTime()) / MINUTE);

    const startsAt = input.startsAtLocal
      ? this.resolveRange(ctx, input.startsAtLocal, durationMin).startsAt
      : existing.startsAt;
    const endsAt = new Date(startsAt.getTime() + durationMin * MINUTE);

    const assigneeMemberId =
      input.assigneeMemberId === undefined
        ? existing.assigneeMemberId
        : await this.resolveAssignee(ctx, input.assigneeMemberId);

    const allowOverlap =
      input.allowOverlap === undefined
        ? existing.allowOverlap
        : this.resolveAllowOverlap(ctx, input.allowOverlap);

    const timeChanged =
      startsAt.getTime() !== existing.startsAt.getTime() ||
      endsAt.getTime() !== existing.endsAt.getTime() ||
      assigneeMemberId !== existing.assigneeMemberId;

    if (assigneeMemberId && !allowOverlap && timeChanged) {
      await this.assertNoConflicts(ctx, { assigneeMemberId, startsAt, endsAt, excludeId: id });
    }

    const updated = await this.appointments
      .update(ctx.workspaceId, id, {
        startsAt,
        endsAt,
        assigneeMemberId,
        allowOverlap,
        ...(input.kind !== undefined ? { kind: input.kind } : {}),
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.note !== undefined ? { note: input.note } : {}),
      })
      .catch((err: unknown) => this.rethrowOverlap(err));

    if (existing.orderId) await this.syncOrderSchedule(ctx.workspaceId, existing.orderId);
    return updated;
  }

  async setStatus(
    ctx: WorkspaceContext,
    id: string,
    to: AppointmentStatus,
    reason?: string | null,
  ): Promise<Appointment> {
    const existing = await this.getById(ctx, id);
    this.assertCanWrite(ctx, existing);

    if (existing.status === to) return existing;

    if (!canTransitionAppointment(existing.status, to)) {
      throw new AppError(
        'invalid_transition',
        `Запись нельзя перевести из «${APPOINTMENT_STATUS_LABELS[existing.status]}» в «${APPOINTMENT_STATUS_LABELS[to]}»`,
        { allowed: ALLOWED_APPOINTMENT_TRANSITIONS[existing.status] },
      );
    }

    if (isOwnerOnlyAppointmentTransition(existing.status, to) && ctx.role !== 'owner') {
      throw AppError.forbidden('Вернуть запись в работу может только владелец мастерской');
    }

    // Возврат в активный статус снова занимает время исполнителя.
    if (to === 'planned' && existing.assigneeMemberId && !existing.allowOverlap) {
      await this.assertNoConflicts(ctx, {
        assigneeMemberId: existing.assigneeMemberId,
        startsAt: existing.startsAt,
        endsAt: existing.endsAt,
        excludeId: id,
      });
    }

    const updated = await this.appointments
      .update(ctx.workspaceId, id, {
        status: to,
        cancelReason: to === 'cancelled' || to === 'no_show' ? (reason ?? null) : null,
      })
      .catch((err: unknown) => this.rethrowOverlap(err));

    if (existing.orderId) await this.syncOrderSchedule(ctx.workspaceId, existing.orderId);
    return updated;
  }

  /** Отмена будущих записей заказа. Вызывается при отмене заказа. */
  async cancelFutureForOrder(
    workspaceId: string,
    orderId: string,
    reason: string,
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const cancelled = await this.appointments.cancelFutureForOrder(
      workspaceId,
      orderId,
      { reason, now: new Date() },
      tx,
    );
    if (cancelled > 0) await this.syncOrderSchedule(workspaceId, orderId, tx);
    return cancelled;
  }

  // ── Свободные слоты ───────────────────────────────────────────────────────

  async availability(
    ctx: WorkspaceContext,
    input: {
      day: string;
      assigneeMemberId?: string;
      durationMin?: number;
      stepMin?: number;
      excludeId?: string;
      now?: Date;
    },
  ): Promise<{
    day: string;
    timezone: string;
    assigneeMemberId: string;
    durationMin: number;
    slots: { startsAtLocal: string; startsAt: string; endsAt: string }[];
    busy: { startsAt: string; endsAt: string }[];
  }> {
    const settings = WorkspacesService.settingsOf(ctx.workspace);
    const durationMin = input.durationMin ?? settings.default_appointment_minutes;
    const stepMin = input.stepMin ?? 30;
    const assigneeMemberId = (await this.resolveAssignee(ctx, input.assigneeMemberId)) ?? '';
    if (!assigneeMemberId) throw AppError.validation('Укажите исполнителя');

    const timezone = ctx.workspace.timezone;
    const startClock = parseClock(settings.work_day_start);
    const endClock = parseClock(settings.work_day_end);
    if (endClock <= startClock) {
      throw AppError.validation('В настройках мастерской конец рабочего дня раньше начала');
    }

    const dayStart = zonedTimeToUtc(`${input.day}T${settings.work_day_start}:00`, timezone);
    const dayEnd = zonedTimeToUtc(`${input.day}T${settings.work_day_end}:00`, timezone);

    const busy = await this.appointments.busyRanges(ctx.workspaceId, {
      assigneeMemberId,
      from: dayStart,
      to: dayEnd,
      excludeId: input.excludeId,
    });

    const work: TimeRange = { start: dayStart.getTime(), end: dayEnd.getTime() };
    const now = input.now ?? new Date();
    const isToday = input.day === todayInZone(timezone, now);

    const slots = availableSlots(
      work,
      busy.map((b) => ({ start: b.startsAt.getTime(), end: b.endsAt.getTime() })),
      {
        durationMs: durationMin * MINUTE,
        stepMs: stepMin * MINUTE,
        ...(isToday ? { notBefore: now.getTime() } : {}),
      },
    );

    return {
      day: input.day,
      timezone,
      assigneeMemberId,
      durationMin,
      slots: slots.map((slot) => ({
        startsAtLocal: utcToZonedString(new Date(slot.start), timezone).slice(11, 16),
        startsAt: new Date(slot.start).toISOString(),
        endsAt: new Date(slot.end).toISOString(),
      })),
      busy: busy.map((b) => ({
        startsAt: b.startsAt.toISOString(),
        endsAt: b.endsAt.toISOString(),
      })),
    };
  }

  // ── Вспомогательное ───────────────────────────────────────────────────────

  private dayBounds(ctx: WorkspaceContext, dayIso: string): { from: Date; to: Date } {
    const from = zonedTimeToUtc(`${dayIso}T00:00:00`, ctx.workspace.timezone);
    return { from, to: new Date(from.getTime() + 86_400_000) };
  }

  private resolveRange(
    ctx: WorkspaceContext,
    startsAtLocal: string,
    durationMin: number,
  ): { startsAt: Date; endsAt: Date } {
    let startsAt: Date;
    try {
      startsAt = zonedTimeToUtc(startsAtLocal, ctx.workspace.timezone);
    } catch {
      throw AppError.validation('Неверный формат времени записи');
    }
    if (Number.isNaN(startsAt.getTime())) throw AppError.validation('Неверное время записи');
    if (durationMin <= 0) throw AppError.validation('Длительность должна быть больше нуля');
    return { startsAt, endsAt: new Date(startsAt.getTime() + durationMin * MINUTE) };
  }

  private resolveAllowOverlap(ctx: WorkspaceContext, requested?: boolean): boolean {
    if (!requested) return false;
    if (!ctx.permissions.has('appointments.override_overlap')) {
      throw AppError.forbidden('Записать поверх занятого времени может только владелец мастерской');
    }
    return true;
  }

  private async resolveAssignee(
    ctx: WorkspaceContext,
    requested: string | null | undefined,
    tx?: Prisma.TransactionClient,
  ): Promise<string | null> {
    if (requested === null) return null;
    if (requested === undefined) return ctx.member.id;
    if (requested !== ctx.member.id && !ctx.permissions.has('appointments.write_all')) {
      throw AppError.forbidden('Записывать на другого исполнителя может только владелец');
    }
    const client = tx ?? this.prisma;
    const member = await client.workspaceMember.findFirst({
      where: { id: requested, workspaceId: ctx.workspaceId, isActive: true },
      select: { id: true },
    });
    if (!member) throw AppError.validation('Сотрудник не найден или деактивирован');
    return member.id;
  }

  /** Сотрудник без права на чужие записи работает только со своими. */
  private assertCanWrite(ctx: WorkspaceContext, appointment: AppointmentWithRelations): void {
    if (ctx.permissions.has('appointments.write_all')) return;
    if (
      !ownsRecord(
        { memberId: ctx.member.id, userId: ctx.userId },
        { assigneeMemberId: appointment.assigneeMemberId, createdBy: appointment.createdById },
      )
    ) {
      throw AppError.notFound('Запись не найдена');
    }
  }

  private assertCanWriteFor(
    ctx: WorkspaceContext,
    order: { assigneeMemberId: string | null; createdById: string | null },
  ): void {
    if (ctx.permissions.has('orders.write_all')) return;
    if (
      !ownsRecord(
        { memberId: ctx.member.id, userId: ctx.userId },
        { assigneeMemberId: order.assigneeMemberId, createdBy: order.createdById },
      )
    ) {
      throw AppError.notFound('Заказ не найден');
    }
  }

  private async assertNoConflicts(
    ctx: WorkspaceContext,
    input: { assigneeMemberId: string; startsAt: Date; endsAt: Date; excludeId?: string },
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const conflicts = await this.appointments.findConflicts(ctx.workspaceId, input, tx);
    if (conflicts.length === 0) return;

    throw new AppError('overlap', 'В это время у исполнителя уже есть запись', {
      conflicts: conflicts.map((c) => ({
        id: c.id,
        startsAt: c.startsAt.toISOString(),
        endsAt: c.endsAt.toISOString(),
        title: c.title,
        clientName: c.client?.name ?? null,
        orderNumber: c.order?.number ?? null,
      })),
      canOverride: ctx.permissions.has('appointments.override_overlap'),
    });
  }

  /**
   * Ограничение базы (EXCLUDE) срабатывает при гонке двух одновременных записей:
   * ответ должен быть тем же, что и при проверке в приложении.
   */
  private rethrowOverlap(err: unknown): never {
    const code = (err as { code?: string }).code;
    const meta = (err as { meta?: { code?: string; constraint?: string } }).meta;
    const pgCode = meta?.code;
    if (
      pgCode === '23P01' ||
      (code === 'P2010' && pgCode === '23P01') ||
      meta?.constraint === 'appointment_no_double_booking'
    ) {
      throw new AppError('overlap', 'В это время у исполнителя уже есть запись', {
        conflicts: [],
        canOverride: true,
      });
    }
    throw err;
  }

  /** `orders.scheduled_start_at` всегда равен началу ближайшей активной записи. */
  private async syncOrderSchedule(
    workspaceId: string,
    orderId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const next = await this.appointments.nextForOrder(workspaceId, orderId, tx);
    await this.orders.update(
      workspaceId,
      orderId,
      { scheduledStartAt: next?.startsAt ?? null },
      tx,
    );
  }
}
