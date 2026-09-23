import { Injectable, Logger } from '@nestjs/common';
import type { Lead, LeadChannel, LeadSource, LeadStatus, Prisma } from '@prisma/client';
import {
  LEAD_CHANNEL_SOURCES,
  LEAD_STATUS_LABELS,
  allowedLeadTransitions,
  canTransitionLead,
  normalizePhone,
  normalizePlate,
  OPEN_LEAD_STATUSES,
  ownsRecord,
  requiresNextContact,
} from '@pdr/shared';
import { AppError } from '@/common/errors/app.error';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { WorkspacesService } from '@/modules/workspaces/workspaces.service';
import type { WorkspaceContext } from '@/modules/workspaces/workspace.types';
import { ClientsRepository } from '../repositories/clients.repository';
import { VehiclesRepository } from '../repositories/vehicles.repository';
import {
  LeadsRepository,
  type LeadListFilter,
  type LeadWithRelations,
} from '../repositories/leads.repository';
import { DamagesRepository } from '../repositories/damages.repository';
import { AssessmentsRepository } from '../repositories/assessments.repository';
import { OrderPhotosRepository } from '../repositories/order-photos.repository';
import { OrdersRepository } from '../repositories/orders.repository';
import { AppointmentsService } from '../appointments/appointments.service';
import { CrmParentAccess } from '../access/crm-parent.access';
import { DamagesService, type DamageInput } from '../damages/damages.service';

export interface LeadContactInput {
  clientId?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  contactExtra?: string | null;
}

export interface LeadVehicleInput {
  vehicleId?: string | null;
  vehicleMake?: string | null;
  vehicleModel?: string | null;
  vehiclePlate?: string | null;
  vehicleYear?: number | null;
  vehicleColor?: string | null;
}

export interface CreateLeadInput extends LeadContactInput, LeadVehicleInput {
  source?: LeadSource;
  channel?: LeadChannel | null;
  comment?: string | null;
  nextContactAt?: Date | null;
  assigneeMemberId?: string | null;
  /**
   * Повреждения, отмеченные на схеме кузова прямо в форме обращения.
   * Создаются в той же транзакции: иначе при обрыве связи осталось бы
   * обращение с пустой схемой, и мастеру пришлось бы отмечать детали заново.
   */
  damages?: DamageInput[];
}

export type UpdateLeadInput = Partial<CreateLeadInput>;

export interface ConvertLeadInput {
  title?: string | null;
  assigneeMemberId?: string | null;
  internalNotes?: string | null;
  /** Первая запись в календарь вместе с заказом. */
  appointment?: {
    startsAtLocal: string;
    durationMin: number;
    kind?: 'inspection' | 'repair' | 'delivery' | 'other';
    note?: string | null;
    allowOverlap?: boolean;
  };
}

/**
 * Обращения — вход в мастерскую.
 *
 * Обращение сознательно не требует клиента в справочнике: половина входящих
 * — это «написали в Telegram, прислали фото, спросили цену», и заводить на
 * каждого такого карточку клиента значит замусорить базу. Клиент и автомобиль
 * создаются в тот момент, когда без них уже нельзя: при записи в календарь
 * или при превращении обращения в заказ. Тогда же в заказ переезжают
 * повреждения, фотографии и оценки — целиком, без повторного заполнения.
 */
@Injectable()
export class LeadsService {
  private readonly logger = new Logger(LeadsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly leads: LeadsRepository,
    private readonly clients: ClientsRepository,
    private readonly vehicles: VehiclesRepository,
    private readonly orders: OrdersRepository,
    private readonly damages: DamagesRepository,
    private readonly assessments: AssessmentsRepository,
    private readonly photos: OrderPhotosRepository,
    private readonly appointments: AppointmentsService,
    private readonly workspaces: WorkspacesService,
    private readonly access: CrmParentAccess,
    private readonly damageParams: DamagesService,
  ) {}

  // ── Чтение ────────────────────────────────────────────────────────────────

  private scopeFilter(ctx: WorkspaceContext, filter: LeadListFilter): LeadListFilter {
    if (ctx.permissions.has('orders.read_all')) return filter;
    return { ...filter, onlyForMember: { memberId: ctx.member.id, userId: ctx.userId } };
  }

  async list(ctx: WorkspaceContext, filter: LeadListFilter) {
    this.assertCanRead(ctx);
    return this.leads.list(ctx.workspaceId, this.scopeFilter(ctx, filter));
  }

  async getById(ctx: WorkspaceContext, leadId: string): Promise<LeadWithRelations> {
    return this.access.readableLead(ctx, leadId);
  }

  async history(ctx: WorkspaceContext, leadId: string) {
    await this.access.readableLead(ctx, leadId);
    return this.leads.history(ctx.workspaceId, leadId);
  }

  /**
   * Счётчики для карточки на главной: «Обращения — 12 / 3 новые · 6 оценены ·
   * 3 перезвонить». Одним запросом: карточка обновляется при каждом открытии.
   */
  async summary(ctx: WorkspaceContext) {
    this.assertCanRead(ctx);
    const filter = this.scopeFilter(ctx, { limit: 1 });
    const byStatus = await this.leads.countByStatus(ctx.workspaceId, filter);
    const due = await this.leads.count(ctx.workspaceId, {
      ...filter,
      statuses: ['callback'],
      dueOnly: true,
    });

    const open = OPEN_LEAD_STATUSES.reduce((sum, status) => sum + (byStatus[status] ?? 0), 0);

    return {
      total: open,
      byStatus: Object.fromEntries(
        OPEN_LEAD_STATUSES.map((status) => [status, byStatus[status] ?? 0]),
      ),
      rejected: byStatus.rejected ?? 0,
      /** Сколько из «перезвонить» уже просрочено: их показывают первыми. */
      due,
    };
  }

  // ── Создание и правка ─────────────────────────────────────────────────────

  async create(ctx: WorkspaceContext, input: CreateLeadInput): Promise<Lead> {
    this.assertCanWrite(ctx);

    const contact = await this.normalizeContact(ctx, input);
    if (
      !contact.clientId &&
      !contact.contactName &&
      !contact.contactPhone &&
      !contact.contactExtra
    ) {
      throw AppError.validation('Укажите, кто обратился: имя, телефон или контакт');
    }

    const vehicle = await this.normalizeVehicle(ctx, input, contact.clientId);
    const assigneeMemberId = await this.resolveAssignee(ctx, input.assigneeMemberId);
    const channel = input.channel ?? null;
    // Канал знает про себя, онлайн он или нет. Явно указанный источник главнее:
    // «позвонил с улицы» бывает, и спорить с мастером незачем.
    const source = input.source ?? (channel ? LEAD_CHANNEL_SOURCES[channel] : 'offline');

    return this.prisma.transaction(async (tx) => {
      const number = await this.leads.nextNumber(ctx.workspaceId, tx);
      const lead = await this.leads.create(
        ctx.workspaceId,
        {
          number,
          ...contact,
          ...vehicle,
          source,
          channel,
          status: 'new',
          comment: input.comment ?? null,
          currency: ctx.workspace.currency,
          nextContactAt: input.nextContactAt ?? null,
          assigneeMemberId,
          createdById: ctx.userId,
        },
        tx,
      );

      await this.leads.addHistory(
        ctx.workspaceId,
        {
          leadId: lead.id,
          fromStatus: null,
          toStatus: 'new',
          changedById: ctx.userId,
          comment: 'Обращение создано',
        },
        tx,
      );

      for (const [index, damage] of (input.damages ?? []).entries()) {
        const created = await this.damages.create(
          ctx.workspaceId,
          {
            leadId: lead.id,
            ...this.damageParams.normalizeInput(damage),
            position: index + 1,
            createdById: ctx.userId,
          },
          tx,
        );
        // Арматурные работы мастер добавляет в той же карточке повреждения,
        // ещё до создания обращения. Потерять их здесь — значит потерять
        // часть согласованной с клиентом работы.
        const works = await this.damageParams.normalizeExtraWorks(ctx, damage.extraWorks);
        if (works !== null && works.length > 0) {
          await this.damages.replaceExtraWorks(ctx.workspaceId, created.id, works, tx);
        }
      }

      return lead;
    });
  }

  /** Повреждения обращения в порядке добавления: нужны, чтобы привязать к ним снимки. */
  async damagesOf(ctx: WorkspaceContext, leadId: string) {
    await this.access.readableLead(ctx, leadId);
    return this.damages.listFor(ctx.workspaceId, { leadId });
  }

  async update(ctx: WorkspaceContext, leadId: string, input: UpdateLeadInput): Promise<Lead> {
    const lead = await this.access.writableLead(ctx, leadId);

    const data: Prisma.LeadUncheckedUpdateInput = {};

    if (
      input.clientId !== undefined ||
      input.contactName !== undefined ||
      input.contactPhone !== undefined ||
      input.contactExtra !== undefined
    ) {
      Object.assign(
        data,
        await this.normalizeContact(ctx, {
          clientId: input.clientId !== undefined ? input.clientId : lead.clientId,
          contactName: input.contactName !== undefined ? input.contactName : lead.contactName,
          contactPhone: input.contactPhone !== undefined ? input.contactPhone : lead.contactPhone,
          contactExtra: input.contactExtra !== undefined ? input.contactExtra : lead.contactExtra,
        }),
      );
    }

    if (
      input.vehicleId !== undefined ||
      input.vehicleMake !== undefined ||
      input.vehicleModel !== undefined ||
      input.vehiclePlate !== undefined ||
      input.vehicleYear !== undefined ||
      input.vehicleColor !== undefined
    ) {
      const clientId = (data.clientId as string | null | undefined) ?? lead.clientId;
      Object.assign(
        data,
        await this.normalizeVehicle(
          ctx,
          {
            vehicleId: input.vehicleId !== undefined ? input.vehicleId : lead.vehicleId,
            vehicleMake: input.vehicleMake !== undefined ? input.vehicleMake : lead.vehicleMake,
            vehicleModel: input.vehicleModel !== undefined ? input.vehicleModel : lead.vehicleModel,
            vehiclePlate: input.vehiclePlate !== undefined ? input.vehiclePlate : lead.vehiclePlate,
            vehicleYear: input.vehicleYear !== undefined ? input.vehicleYear : lead.vehicleYear,
            vehicleColor: input.vehicleColor !== undefined ? input.vehicleColor : lead.vehicleColor,
          },
          clientId,
        ),
      );
    }

    if (input.source !== undefined) data.source = input.source;
    if (input.channel !== undefined) data.channel = input.channel;
    if (input.comment !== undefined) data.comment = input.comment;
    if (input.nextContactAt !== undefined) data.nextContactAt = input.nextContactAt;
    if (input.assigneeMemberId !== undefined) {
      data.assigneeMemberId = await this.resolveAssignee(ctx, input.assigneeMemberId, true);
    }

    return this.leads.update(ctx.workspaceId, leadId, data);
  }

  // ── Статусы ───────────────────────────────────────────────────────────────

  async transition(
    ctx: WorkspaceContext,
    leadId: string,
    to: LeadStatus,
    input: { comment?: string | null; nextContactAt?: Date | null } = {},
  ): Promise<Lead> {
    const lead = await this.access.writableLead(ctx, leadId);
    if (lead.status === to) return lead;

    if (!canTransitionLead(lead.status, to)) {
      throw new AppError(
        'invalid_transition',
        `Обращение нельзя перевести из «${LEAD_STATUS_LABELS[lead.status]}» в «${LEAD_STATUS_LABELS[to]}»`,
        { allowed: allowedLeadTransitions(lead.status) },
      );
    }
    if (to === 'rejected' && !input.comment?.trim()) {
      throw AppError.validation('Укажите причину отказа');
    }
    // Без даты «перезвонить» превращается в «забыть»: список обращений именно
    // по ней и собирает тех, кому пора звонить сегодня.
    if (requiresNextContact(to) && !input.nextContactAt && !lead.nextContactAt) {
      throw AppError.validation('Укажите, когда перезвонить');
    }

    return this.prisma.transaction(async (tx) => {
      const updated = await this.leads.update(
        ctx.workspaceId,
        leadId,
        {
          status: to,
          ...(to === 'rejected' ? { rejectReason: input.comment ?? null } : {}),
          ...(input.nextContactAt !== undefined ? { nextContactAt: input.nextContactAt } : {}),
          // Дошли до записи или отказа — напоминание больше не нужно.
          ...(to === 'scheduled' || to === 'rejected' ? { nextContactAt: null } : {}),
        },
        tx,
      );

      await this.leads.addHistory(
        ctx.workspaceId,
        {
          leadId,
          fromStatus: lead.status,
          toStatus: to,
          changedById: ctx.userId,
          comment: input.comment ?? null,
        },
        tx,
      );

      return updated;
    });
  }

  async archive(ctx: WorkspaceContext, leadId: string, archived: boolean): Promise<Lead> {
    await this.access.readableLead(ctx, leadId);
    if (!ctx.permissions.has('leads.manage')) {
      throw AppError.forbidden('Архивировать обращения может только владелец мастерской');
    }
    return this.leads.update(ctx.workspaceId, leadId, {
      archivedAt: archived ? new Date() : null,
    });
  }

  // ── Запись в календарь и конверсия ────────────────────────────────────────

  /**
   * Запись клиента по обращению.
   *
   * Клиент и автомобиль создаются здесь, если их ещё нет: календарь работает
   * с клиентами, а не со свободным текстом. Обращение переходит в «Записан».
   */
  async schedule(
    ctx: WorkspaceContext,
    leadId: string,
    input: {
      startsAtLocal: string;
      durationMin: number;
      kind?: 'inspection' | 'repair' | 'delivery' | 'other';
      note?: string | null;
      allowOverlap?: boolean;
      assigneeMemberId?: string | null;
    },
  ): Promise<{ leadId: string; appointmentId: string; clientId: string }> {
    const lead = await this.access.writableLead(ctx, leadId);

    return this.prisma.transaction(async (tx) => {
      const { clientId, vehicleId } = await this.materializeClient(ctx, lead, tx);

      const appointment = await this.appointments.createWithin(tx, ctx, {
        leadId: lead.id,
        clientId,
        assigneeMemberId: input.assigneeMemberId ?? lead.assigneeMemberId ?? undefined,
        startsAtLocal: input.startsAtLocal,
        durationMin: input.durationMin,
        kind: input.kind ?? 'inspection',
        note: input.note ?? null,
        allowOverlap: input.allowOverlap,
      });

      if (lead.status !== 'scheduled' && canTransitionLead(lead.status, 'scheduled')) {
        await this.leads.update(
          ctx.workspaceId,
          leadId,
          { status: 'scheduled', clientId, vehicleId, nextContactAt: null },
          tx,
        );
        await this.leads.addHistory(
          ctx.workspaceId,
          {
            leadId,
            fromStatus: lead.status,
            toStatus: 'scheduled',
            changedById: ctx.userId,
            comment: 'Клиент записан в календарь',
          },
          tx,
        );
      } else {
        await this.leads.update(ctx.workspaceId, leadId, { clientId, vehicleId }, tx);
      }

      return { leadId, appointmentId: appointment.id, clientId };
    });
  }

  /**
   * Превращение обращения в заказ.
   *
   * Всё, что уже собрано по обращению, переезжает в заказ одной транзакцией:
   * клиент, автомобиль, повреждения на схеме, фотографии с разметкой и
   * сделанные оценки. Ничего не копируется — именно поэтому у мастера не
   * возникает двух расходящихся версий одного и того же повреждения.
   */
  async convert(
    ctx: WorkspaceContext,
    leadId: string,
    input: ConvertLeadInput = {},
  ): Promise<{ orderId: string; orderNumber: number; movedDamages: number; movedPhotos: number }> {
    const lead = await this.access.writableLead(ctx, leadId);

    if (!ctx.permissions.has('orders.create')) {
      throw AppError.forbidden('Недостаточно прав для создания заказа');
    }
    if (lead.convertedOrderId) {
      throw new AppError('already_exists', 'По этому обращению уже создан заказ', {
        orderId: lead.convertedOrderId,
      });
    }
    if (lead.status === 'rejected') {
      throw new AppError('invalid_transition', 'Обращение закрыто отказом: заведите новое');
    }

    const assigneeMemberId = await this.resolveAssignee(
      ctx,
      input.assigneeMemberId ?? lead.assigneeMemberId,
    );

    return this.prisma.transaction(async (tx) => {
      const { clientId, vehicleId } = await this.materializeClient(ctx, lead, tx);

      const number = await this.workspaces.nextOrderNumber(ctx.workspaceId, tx);
      const order = await this.orders.create(
        ctx.workspaceId,
        {
          number,
          clientId,
          vehicleId,
          assigneeMemberId,
          status: 'new',
          paymentStatus: 'unpaid',
          currency: lead.currency,
          title: input.title ?? this.defaultOrderTitle(lead),
          // Комментарий клиента — это и есть описание повреждений, которое он
          // дал при обращении. Переписывать его руками незачем.
          damageSummary: lead.comment ?? null,
          internalNotes: input.internalNotes ?? null,
          createdById: ctx.userId,
        },
        tx,
      );

      await this.orders.addHistory(
        ctx.workspaceId,
        {
          orderId: order.id,
          fromStatus: null,
          toStatus: 'new',
          changedById: ctx.userId,
          comment: `Заказ создан из обращения №${lead.number}`,
        },
        tx,
      );

      const movedDamages = await this.damages.moveToOrder(ctx.workspaceId, leadId, order.id, tx);
      const movedPhotos = await this.photos.moveToOrder(ctx.workspaceId, leadId, order.id, tx);
      await this.assessments.moveToOrder(ctx.workspaceId, leadId, order.id, tx);
      // Запись в календарь остаётся привязанной к обращению и получает заказ:
      // иначе мастер увидел бы в календаре запись без заказа.
      await tx.appointment.updateMany({
        where: { workspaceId: ctx.workspaceId, leadId, orderId: null },
        data: { orderId: order.id, clientId },
      });

      await this.leads.update(
        ctx.workspaceId,
        leadId,
        {
          clientId,
          vehicleId,
          convertedOrderId: order.id,
          convertedAt: new Date(),
          nextContactAt: null,
        },
        tx,
      );

      await this.leads.addHistory(
        ctx.workspaceId,
        {
          leadId,
          fromStatus: lead.status,
          toStatus: lead.status,
          changedById: ctx.userId,
          comment: `Создан заказ №${order.number}`,
        },
        tx,
      );

      return { orderId: order.id, orderNumber: order.number, movedDamages, movedPhotos };
    });
  }

  // ── Вспомогательное ───────────────────────────────────────────────────────

  private assertCanRead(ctx: WorkspaceContext): void {
    if (!ctx.permissions.has('leads.read')) {
      throw AppError.forbidden('Недостаточно прав для просмотра обращений');
    }
  }

  private assertCanWrite(ctx: WorkspaceContext): void {
    if (!ctx.permissions.has('leads.write')) {
      throw AppError.forbidden('Недостаточно прав для работы с обращениями');
    }
  }

  private defaultOrderTitle(lead: Lead): string | null {
    const car = [lead.vehicleMake, lead.vehicleModel].filter(Boolean).join(' ').trim();
    return car ? `Обращение №${lead.number}, ${car}` : `Обращение №${lead.number}`;
  }

  /**
   * Клиент и автомобиль из обращения.
   *
   * Если они уже выбраны — используются как есть. Если обращение жило на
   * свободном контакте — заводятся здесь, из тех же полей, что ввёл мастер.
   * Повторного заполнения формы не происходит ни в одном из случаев.
   */
  private async materializeClient(
    ctx: WorkspaceContext,
    lead: Lead,
    tx: Prisma.TransactionClient,
  ): Promise<{ clientId: string; vehicleId: string | null }> {
    let clientId = lead.clientId;

    if (!clientId) {
      const name = lead.contactName?.trim();
      if (!name && !lead.contactPhone) {
        throw AppError.validation('Укажите имя или телефон клиента');
      }
      const created = await tx.client.create({
        data: {
          workspaceId: ctx.workspaceId,
          name: name || (lead.contactPhone ?? 'Без имени'),
          phone: lead.contactPhone ?? null,
          telegramUsername: lead.channel === 'telegram' ? (lead.contactExtra ?? null) : null,
          source: lead.channel ?? lead.source,
          createdById: ctx.userId,
        },
      });
      clientId = created.id;
    }

    let vehicleId = lead.vehicleId;
    if (!vehicleId && lead.vehicleMake && lead.vehicleModel) {
      const created = await tx.vehicle.create({
        data: {
          workspaceId: ctx.workspaceId,
          clientId,
          make: lead.vehicleMake.trim(),
          model: lead.vehicleModel.trim(),
          year: lead.vehicleYear,
          color: lead.vehicleColor,
          plate: normalizePlate(lead.vehiclePlate),
        },
      });
      vehicleId = created.id;
    }

    return { clientId, vehicleId };
  }

  private async normalizeContact(
    ctx: WorkspaceContext,
    input: LeadContactInput,
  ): Promise<{
    clientId: string | null;
    contactName: string | null;
    contactPhone: string | null;
    contactExtra: string | null;
  }> {
    const clientId = input.clientId ?? null;
    if (clientId) {
      const client = await this.clients.findById(ctx.workspaceId, clientId);
      if (!client) throw AppError.notFound('Клиент не найден');
    }

    const rawPhone = input.contactPhone?.trim() || null;
    const contactPhone = rawPhone ? normalizePhone(rawPhone) : null;
    if (rawPhone && !contactPhone) {
      throw AppError.validation('Не удалось разобрать номер телефона');
    }

    return {
      clientId,
      contactName: input.contactName?.trim() || null,
      contactPhone,
      contactExtra: input.contactExtra?.trim() || null,
    };
  }

  private async normalizeVehicle(
    ctx: WorkspaceContext,
    input: LeadVehicleInput,
    clientId: string | null,
  ): Promise<{
    vehicleId: string | null;
    vehicleMake: string | null;
    vehicleModel: string | null;
    vehiclePlate: string | null;
    vehicleYear: number | null;
    vehicleColor: string | null;
  }> {
    const vehicleId = input.vehicleId ?? null;
    if (vehicleId) {
      const vehicle = await this.vehicles.findById(ctx.workspaceId, vehicleId);
      if (!vehicle) throw AppError.validation('Автомобиль не найден');
      if (clientId && vehicle.clientId !== clientId) {
        throw AppError.validation('Автомобиль не найден у этого клиента');
      }
      // Марка и модель дублируются в обращение намеренно: список обращений
      // читается без запроса в таблицу автомобилей.
      return {
        vehicleId,
        vehicleMake: vehicle.make,
        vehicleModel: vehicle.model,
        vehiclePlate: vehicle.plate,
        vehicleYear: vehicle.year,
        vehicleColor: vehicle.color,
      };
    }

    return {
      vehicleId: null,
      vehicleMake: input.vehicleMake?.trim() || null,
      vehicleModel: input.vehicleModel?.trim() || null,
      vehiclePlate: normalizePlate(input.vehiclePlate ?? null),
      vehicleYear: input.vehicleYear ?? null,
      vehicleColor: input.vehicleColor?.trim() || null,
    };
  }

  private async resolveAssignee(
    ctx: WorkspaceContext,
    requested: string | null | undefined,
    allowNull = false,
  ): Promise<string | null> {
    if (requested === null && allowNull) return null;
    if (requested === undefined || requested === null) return ctx.member.id;

    if (requested !== ctx.member.id && !ctx.permissions.has('orders.assign')) {
      throw AppError.forbidden('Назначать другого исполнителя может только владелец мастерской');
    }
    const member = await this.prisma.workspaceMember.findFirst({
      where: { id: requested, workspaceId: ctx.workspaceId, isActive: true },
      select: { id: true },
    });
    if (!member) throw AppError.validation('Сотрудник не найден или деактивирован');
    return member.id;
  }

  /** Сотрудник без права видеть чужое работает только со своими обращениями. */
  assertOwn(ctx: WorkspaceContext, lead: Lead): void {
    if (ctx.permissions.has('orders.read_all')) return;
    if (!ownsRecord({ memberId: ctx.member.id, userId: ctx.userId }, lead)) {
      throw AppError.notFound('Обращение не найдено');
    }
  }
}
