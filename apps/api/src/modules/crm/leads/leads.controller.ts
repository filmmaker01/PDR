import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  LEAD_CHANNEL_LABELS,
  LEAD_SOURCE_LABELS,
  LEAD_STATUS_LABELS,
  allowedLeadTransitions,
} from '@pdr/shared';
import { Idempotent } from '@/common/interceptors/idempotency.interceptor';
import { zodBody } from '@/common/pipes/zod-validation.pipe';
import { CurrentAuth, type AuthContext } from '@/modules/auth/decorators/auth.decorators';
import { Audited } from '@/modules/audit/audit.interceptor';
import { AllowExpiredAccess, Can, Workspace } from '@/modules/workspaces/guards/workspace.guard';
import { Ws } from '@/modules/workspaces/decorators/workspace.decorators';
import type { WorkspaceContext } from '@/modules/workspaces/workspace.types';
import { LeadsService } from './leads.service';
import { DamagesService } from '../damages/damages.service';
import { OrderPhotosService, type DraftPhotoInput } from '../photos/order-photos.service';
import type { LeadWithRelations } from '../repositories/leads.repository';
import { serializeDamage, serializePhoto } from '../serializers';
import {
  leadArchiveSchema,
  leadConvertSchema,
  leadListQuerySchema,
  leadScheduleSchema,
  leadTransitionSchema,
  createLeadSchema,
  updateLeadSchema,
} from '../dto/leads.dto';

function serializeLead(lead: LeadWithRelations): Record<string, unknown> {
  return {
    id: lead.id,
    number: lead.number,
    status: lead.status,
    statusLabel: LEAD_STATUS_LABELS[lead.status],
    source: lead.source,
    sourceLabel: LEAD_SOURCE_LABELS[lead.source],
    channel: lead.channel,
    channelLabel: lead.channel ? LEAD_CHANNEL_LABELS[lead.channel] : null,
    // Контакт показывается одинаково независимо от того, есть клиент в базе
    // или обращение пока живёт на свободном контакте.
    contact: {
      clientId: lead.clientId,
      name: lead.client?.name ?? lead.contactName,
      phone: lead.client?.phone ?? lead.contactPhone,
      extra: lead.contactExtra,
    },
    vehicle: {
      vehicleId: lead.vehicleId,
      make: lead.vehicle?.make ?? lead.vehicleMake,
      model: lead.vehicle?.model ?? lead.vehicleModel,
      plate: lead.vehicle?.plate ?? lead.vehiclePlate,
      year: lead.vehicleYear,
      color: lead.vehicleColor,
    },
    comment: lead.comment,
    estimateMinor: lead.estimateMinor === null ? null : Number(lead.estimateMinor),
    currency: lead.currency,
    nextContactAt: lead.nextContactAt?.toISOString() ?? null,
    rejectReason: lead.rejectReason,
    assignee: lead.assignee
      ? {
          id: lead.assignee.id,
          name:
            lead.assignee.displayName ??
            [lead.assignee.user.firstName, lead.assignee.user.lastName].filter(Boolean).join(' '),
          color: lead.assignee.color,
        }
      : null,
    convertedOrder: lead.convertedOrder
      ? { id: lead.convertedOrder.id, number: lead.convertedOrder.number }
      : null,
    convertedAt: lead.convertedAt?.toISOString() ?? null,
    archivedAt: lead.archivedAt?.toISOString() ?? null,
    createdAt: lead.createdAt.toISOString(),
    allowedTransitions: allowedLeadTransitions(lead.status).map((status) => ({
      status,
      label: LEAD_STATUS_LABELS[status],
    })),
  };
}

@ApiTags('crm')
@Controller('workspaces/:workspaceId/leads')
@Workspace()
export class LeadsController {
  constructor(
    private readonly leads: LeadsService,
    private readonly damages: DamagesService,
    private readonly photos: OrderPhotosService,
  ) {}

  @Get('summary')
  @Can('leads.read')
  @AllowExpiredAccess()
  @ApiOperation({ summary: 'Счётчики обращений для карточки на главной' })
  async summary(@Ws() ws: WorkspaceContext) {
    return this.leads.summary(ws);
  }

  @Get()
  @Can('leads.read')
  @AllowExpiredAccess()
  @ApiOperation({ summary: 'Обращения с поиском и фильтрами' })
  async list(@Ws() ws: WorkspaceContext, @Query() query: Record<string, string>) {
    const parsed = leadListQuerySchema.parse(query);
    const result = await this.leads.list(ws, {
      statuses: parsed.status,
      source: parsed.source,
      channel: parsed.channel,
      assigneeMemberId: parsed.assigneeMemberId,
      q: parsed.q,
      dueOnly: parsed.due,
      archived: parsed.archived,
      limit: parsed.limit,
      cursor: parsed.cursor,
    });
    return { items: result.items.map(serializeLead), nextCursor: result.nextCursor };
  }

  @Post()
  @Can('leads.write')
  @Idempotent()
  @Audited({ entityType: 'lead', action: 'create', idFrom: { responseField: 'id' } })
  @ApiOperation({ summary: 'Новое обращение вместе с отмеченными деталями и фотографиями' })
  async create(
    @Ws() ws: WorkspaceContext,
    @Body(zodBody(createLeadSchema)) body: Record<string, never>,
    @CurrentAuth() auth: AuthContext,
  ) {
    const input = body as unknown as Parameters<LeadsService['create']>[1] & {
      photos?: DraftPhotoInput[];
    };
    const lead = await this.leads.create(ws, input);

    // Снимки привязываются после обращения: файл уже загружен в хранилище,
    // и его проверка не должна держать транзакцию с базой открытой.
    const photos =
      input.photos && input.photos.length > 0
        ? await this.photos.attachDraftPhotos(
            ws,
            { leadId: lead.id },
            input.photos,
            (await this.leads.damagesOf(ws, lead.id)).map((damage) => damage.id),
            auth,
          )
        : { attached: 0, failed: [], markupFailed: 0 };

    return {
      id: lead.id,
      number: lead.number,
      status: lead.status,
      photos,
    };
  }

  @Get(':leadId')
  @Can('leads.read')
  @AllowExpiredAccess()
  @ApiOperation({ summary: 'Карточка обращения' })
  async get(@Ws() ws: WorkspaceContext, @Param('leadId') leadId: string) {
    const lead = await this.leads.getById(ws, leadId);
    const history = await this.leads.history(ws, leadId);

    return {
      ...serializeLead(lead),
      history: history.map((entry) => ({
        id: entry.id,
        fromStatus: entry.fromStatus,
        toStatus: entry.toStatus,
        comment: entry.comment,
        createdAt: entry.createdAt.toISOString(),
        changedBy: entry.changedBy
          ? [entry.changedBy.firstName, entry.changedBy.lastName].filter(Boolean).join(' ')
          : 'система',
      })),
    };
  }

  @Patch(':leadId')
  @Can('leads.write')
  @Audited({ entityType: 'lead', idFrom: { param: 'leadId' } })
  @ApiOperation({ summary: 'Изменение обращения' })
  async update(
    @Ws() ws: WorkspaceContext,
    @Param('leadId') leadId: string,
    @Body(zodBody(updateLeadSchema)) body: Record<string, never>,
  ) {
    const lead = await this.leads.update(ws, leadId, body as never);
    return { id: lead.id, status: lead.status };
  }

  @Post(':leadId/transition')
  @Can('leads.write')
  @Audited({ entityType: 'lead', action: 'status_change', idFrom: { param: 'leadId' } })
  @ApiOperation({ summary: 'Смена статуса обращения' })
  async transition(
    @Ws() ws: WorkspaceContext,
    @Param('leadId') leadId: string,
    @Body(zodBody(leadTransitionSchema))
    body: { to: never; comment?: string | null; nextContactAt?: Date | null },
  ) {
    const lead = await this.leads.transition(ws, leadId, body.to, {
      comment: body.comment,
      nextContactAt: body.nextContactAt,
    });
    return {
      id: lead.id,
      status: lead.status,
      statusLabel: LEAD_STATUS_LABELS[lead.status],
      nextContactAt: lead.nextContactAt?.toISOString() ?? null,
      allowedTransitions: allowedLeadTransitions(lead.status).map((status) => ({
        status,
        label: LEAD_STATUS_LABELS[status],
      })),
    };
  }

  @Post(':leadId/schedule')
  @Can('leads.write')
  @Idempotent()
  @Audited({ entityType: 'lead', action: 'schedule', idFrom: { param: 'leadId' } })
  @ApiOperation({ summary: 'Запись клиента по обращению в календарь' })
  async schedule(
    @Ws() ws: WorkspaceContext,
    @Param('leadId') leadId: string,
    @Body(zodBody(leadScheduleSchema)) body: Record<string, never>,
  ) {
    return this.leads.schedule(ws, leadId, body as never);
  }

  @Post(':leadId/convert')
  @Can('leads.write')
  @Idempotent()
  @Audited({ entityType: 'lead', action: 'convert', idFrom: { param: 'leadId' } })
  @ApiOperation({ summary: 'Превращение обращения в заказ без повторного ввода данных' })
  async convert(
    @Ws() ws: WorkspaceContext,
    @Param('leadId') leadId: string,
    @Body(zodBody(leadConvertSchema)) body: Record<string, never>,
  ) {
    return this.leads.convert(ws, leadId, body as never);
  }

  @Post(':leadId/archive')
  @Can('leads.manage')
  @Audited({ entityType: 'lead', action: 'archive', idFrom: { param: 'leadId' } })
  @ApiOperation({ summary: 'Архивирование обращения' })
  async archive(
    @Ws() ws: WorkspaceContext,
    @Param('leadId') leadId: string,
    @Body(zodBody(leadArchiveSchema)) body: { archived: boolean },
  ) {
    const lead = await this.leads.archive(ws, leadId, body.archived);
    return { id: lead.id, archivedAt: lead.archivedAt?.toISOString() ?? null };
  }

  @Get(':leadId/photos')
  @Can('leads.read')
  @AllowExpiredAccess()
  @ApiOperation({ summary: 'Фотографии обращения' })
  async photoList(
    @Ws() ws: WorkspaceContext,
    @Param('leadId') leadId: string,
    @CurrentAuth() auth: AuthContext,
  ) {
    const { items } = await this.photos.listFor(ws, { leadId }, auth);
    return { items: items.map(serializePhoto) };
  }

  @Get(':leadId/damages')
  @Can('leads.read')
  @AllowExpiredAccess()
  @ApiOperation({ summary: 'Повреждения, отмеченные на схеме кузова' })
  async damageList(@Ws() ws: WorkspaceContext, @Param('leadId') leadId: string) {
    const items = await this.damages.listFor(ws, { leadId });
    return { items: items.map(serializeDamage) };
  }
}
