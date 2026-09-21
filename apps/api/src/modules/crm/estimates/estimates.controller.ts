import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ACCESS_DIFFICULTY_LABELS,
  BODY_PANELS,
  DAMAGE_TYPES,
  ESTIMATE_ITEM_KINDS,
  ESTIMATE_ITEM_KIND_LABELS,
  MATERIAL_LABELS,
  PRICE_UNIT_LABELS,
  SIZE_CLASSES,
} from '@pdr/shared';
import { Idempotent } from '@/common/interceptors/idempotency.interceptor';
import { zodBody } from '@/common/pipes/zod-validation.pipe';
import { Audited } from '@/modules/audit/audit.interceptor';
import { AllowExpiredAccess, Can, Workspace } from '@/modules/workspaces/guards/workspace.guard';
import { Ws } from '@/modules/workspaces/decorators/workspace.decorators';
import type { WorkspaceContext } from '@/modules/workspaces/workspace.types';
import { EstimatesService } from './estimates.service';
import { PriceListService } from './price-list.service';
import { EstimatePdfService } from './estimate-pdf.service';
import { ESTIMATE_STATUS_LABELS } from './estimate-rules';
import { OrdersRepository } from '../repositories/orders.repository';
import type { EstimateWithItems } from '../repositories/estimates.repository';
import {
  createEstimateSchema,
  estimateItemsSchema,
  estimateSettingsSchema,
  priceListItemSchema,
  rejectEstimateSchema,
  reorderPriceListSchema,
  updatePriceListItemSchema,
} from '../dto/crm.dto';

function serializeEstimate(estimate: EstimateWithItems): Record<string, unknown> {
  return {
    id: estimate.id,
    orderId: estimate.orderId,
    versionNo: estimate.versionNo,
    status: estimate.status,
    statusLabel: ESTIMATE_STATUS_LABELS[estimate.status],
    currency: estimate.currency,
    subtotalMinor: Number(estimate.subtotalMinor),
    discountKind: estimate.discountKind,
    discountValue: estimate.discountValue,
    discountMinor: Number(estimate.discountMinor),
    totalMinor: Number(estimate.totalMinor),
    noteForClient: estimate.noteForClient,
    internalNote: estimate.internalNote,
    sentAt: estimate.sentAt?.toISOString() ?? null,
    agreedAt: estimate.agreedAt?.toISOString() ?? null,
    rejectedAt: estimate.rejectedAt?.toISOString() ?? null,
    rejectReason: estimate.rejectReason,
    createdAt: estimate.createdAt.toISOString(),
    createdBy: estimate.createdBy
      ? [estimate.createdBy.firstName, estimate.createdBy.lastName].filter(Boolean).join(' ')
      : null,
    agreedBy: estimate.agreedBy
      ? [estimate.agreedBy.firstName, estimate.agreedBy.lastName].filter(Boolean).join(' ')
      : null,
    items: estimate.items.map((item) => ({
      id: item.id,
      position: item.position,
      kind: item.kind,
      kindLabel: ESTIMATE_ITEM_KIND_LABELS[item.kind] ?? item.kind,
      title: item.title,
      panelCode: item.panelCode,
      damageType: item.damageType,
      sizeClass: item.sizeClass,
      quantity: item.quantity,
      material: item.material,
      accessDifficulty: item.accessDifficulty,
      onEdge: item.onEdge,
      unitPriceMinor: Number(item.unitPriceMinor),
      lineTotalMinor: Number(item.lineTotalMinor),
      priceListItemId: item.priceListItemId,
      comment: item.comment,
    })),
  };
}

@ApiTags('crm')
@Controller('workspaces/:workspaceId')
@Workspace()
export class EstimatesController {
  constructor(
    private readonly estimates: EstimatesService,
    private readonly priceList: PriceListService,
    private readonly pdf: EstimatePdfService,
    private readonly orders: OrdersRepository,
  ) {}

  // ── Справочники ───────────────────────────────────────────────────────────

  @Get('pdr-dictionaries')
  @Can('estimates.read')
  @AllowExpiredAccess()
  @ApiOperation({ summary: 'Справочники: элементы кузова, типы повреждений, размеры' })
  dictionaries() {
    return {
      panels: BODY_PANELS,
      damageTypes: DAMAGE_TYPES,
      sizeClasses: SIZE_CLASSES,
      itemKinds: ESTIMATE_ITEM_KIND_LABELS,
      materials: MATERIAL_LABELS,
      accessDifficulties: ACCESS_DIFFICULTY_LABELS,
      priceUnits: PRICE_UNIT_LABELS,
    };
  }

  // ── Прайс ─────────────────────────────────────────────────────────────────

  @Get('price-list')
  @Can('price_list.read')
  @AllowExpiredAccess()
  @ApiOperation({ summary: 'Прайс мастерской' })
  async listPrices(
    @Ws() ws: WorkspaceContext,
    @Query('all') all?: string,
    @Query('kind') kind?: string,
  ) {
    const parsedKind = ESTIMATE_ITEM_KINDS.find((value) => value === kind);
    const items = await this.priceList.list(ws, all === 'true', parsedKind);
    return items.map((item) => ({
      id: item.id,
      kind: item.kind,
      title: item.title,
      panelCode: item.panelCode,
      damageType: item.damageType,
      sizeClass: item.sizeClass,
      unitPriceMinor: Number(item.unitPriceMinor),
      unit: item.unit,
      unitLabel: PRICE_UNIT_LABELS[item.unit] ?? item.unit,
      isActive: item.isActive,
      position: item.position,
    }));
  }

  @Post('price-list')
  @Can('price_list.manage')
  @Audited({ entityType: 'price_list_item', action: 'create', idFrom: { responseField: 'id' } })
  @ApiOperation({ summary: 'Новая позиция прайса' })
  async createPrice(
    @Ws() ws: WorkspaceContext,
    @Body(zodBody(priceListItemSchema)) body: Record<string, never>,
  ) {
    const item = await this.priceList.create(ws, body as never);
    return { id: item.id, title: item.title, unitPriceMinor: Number(item.unitPriceMinor) };
  }

  @Patch('price-list/:itemId')
  @Can('price_list.manage')
  @Audited({ entityType: 'price_list_item', idFrom: { param: 'itemId' } })
  @ApiOperation({ summary: 'Изменение позиции прайса' })
  async updatePrice(
    @Ws() ws: WorkspaceContext,
    @Param('itemId') itemId: string,
    @Body(zodBody(updatePriceListItemSchema)) body: Record<string, never>,
  ) {
    const item = await this.priceList.update(ws, itemId, body as never);
    return { id: item.id, title: item.title, unitPriceMinor: Number(item.unitPriceMinor) };
  }

  @Post('price-list/reorder')
  @Can('price_list.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Порядок позиций прайса' })
  async reorderPrices(
    @Ws() ws: WorkspaceContext,
    @Body(zodBody(reorderPriceListSchema)) body: { ids: string[] },
  ): Promise<void> {
    await this.priceList.reorder(ws, body.ids);
  }

  @Delete('price-list/:itemId')
  @Can('price_list.manage')
  @Audited({ entityType: 'price_list_item', action: 'delete', idFrom: { param: 'itemId' } })
  @ApiOperation({ summary: 'Удаление позиции прайса (использованная — деактивируется)' })
  async removePrice(@Ws() ws: WorkspaceContext, @Param('itemId') itemId: string) {
    return this.priceList.remove(ws, itemId);
  }

  // ── Сметы ─────────────────────────────────────────────────────────────────

  @Get('orders/:orderId/estimates')
  @Can('estimates.read')
  @AllowExpiredAccess()
  @ApiOperation({ summary: 'Версии сметы заказа' })
  async list(@Ws() ws: WorkspaceContext, @Param('orderId') orderId: string) {
    const estimates = await this.estimates.listForOrder(ws, orderId);
    return estimates.map(serializeEstimate);
  }

  @Post('orders/:orderId/estimates')
  @Can('estimates.write_own')
  @Idempotent()
  @Audited({ entityType: 'estimate', action: 'create', idFrom: { responseField: 'id' } })
  @ApiOperation({ summary: 'Новая смета (черновик)' })
  async create(
    @Ws() ws: WorkspaceContext,
    @Param('orderId') orderId: string,
    @Body(zodBody(createEstimateSchema)) body: { fromEstimateId?: string | null },
  ) {
    const estimate = await this.estimates.create(ws, orderId, body);
    return { id: estimate.id, versionNo: estimate.versionNo, status: estimate.status };
  }

  @Get('estimates/:estimateId')
  @Can('estimates.read')
  @AllowExpiredAccess()
  @ApiOperation({ summary: 'Смета с позициями' })
  async get(@Ws() ws: WorkspaceContext, @Param('estimateId') estimateId: string) {
    return serializeEstimate(await this.estimates.getById(ws, estimateId));
  }

  @Patch('estimates/:estimateId')
  @Can('estimates.write_own')
  @Audited({ entityType: 'estimate', idFrom: { param: 'estimateId' } })
  @ApiOperation({ summary: 'Скидка и заметки' })
  async update(
    @Ws() ws: WorkspaceContext,
    @Param('estimateId') estimateId: string,
    @Body(zodBody(estimateSettingsSchema)) body: Record<string, never>,
  ) {
    await this.estimates.updateSettings(ws, estimateId, body as never);
    return serializeEstimate(await this.estimates.getById(ws, estimateId));
  }

  @Put('estimates/:estimateId/items')
  @Can('estimates.write_own')
  @Audited({ entityType: 'estimate', action: 'items', idFrom: { param: 'estimateId' } })
  @ApiOperation({ summary: 'Полная замена позиций сметы' })
  async replaceItems(
    @Ws() ws: WorkspaceContext,
    @Param('estimateId') estimateId: string,
    @Body(zodBody(estimateItemsSchema)) body: { items: Record<string, never>[] },
  ) {
    const estimate = await this.estimates.replaceItems(ws, estimateId, body.items as never);
    return serializeEstimate(estimate);
  }

  @Post('estimates/:estimateId/send')
  @Can('estimates.write_own')
  @Audited({ entityType: 'estimate', action: 'send', idFrom: { param: 'estimateId' } })
  @ApiOperation({ summary: 'Смета отправлена клиенту' })
  async send(@Ws() ws: WorkspaceContext, @Param('estimateId') estimateId: string) {
    await this.estimates.send(ws, estimateId);
    return serializeEstimate(await this.estimates.getById(ws, estimateId));
  }

  @Post('estimates/:estimateId/agree')
  @Can('estimates.write_own')
  @Idempotent()
  @Audited({ entityType: 'estimate', action: 'agree', idFrom: { param: 'estimateId' } })
  @ApiOperation({ summary: 'Согласование сметы клиентом' })
  async agree(@Ws() ws: WorkspaceContext, @Param('estimateId') estimateId: string) {
    await this.estimates.agree(ws, estimateId);
    return serializeEstimate(await this.estimates.getById(ws, estimateId));
  }

  @Post('estimates/:estimateId/reject')
  @Can('estimates.write_own')
  @Audited({ entityType: 'estimate', action: 'reject', idFrom: { param: 'estimateId' } })
  @ApiOperation({ summary: 'Клиент отказался от сметы' })
  async reject(
    @Ws() ws: WorkspaceContext,
    @Param('estimateId') estimateId: string,
    @Body(zodBody(rejectEstimateSchema)) body: { reason?: string | null },
  ) {
    await this.estimates.reject(ws, estimateId, body.reason);
    return serializeEstimate(await this.estimates.getById(ws, estimateId));
  }

  @Post('estimates/:estimateId/new-version')
  @Can('estimates.write_own')
  @Idempotent()
  @Audited({ entityType: 'estimate', action: 'new_version', idFrom: { responseField: 'id' } })
  @ApiOperation({ summary: 'Новая версия сметы' })
  async newVersion(@Ws() ws: WorkspaceContext, @Param('estimateId') estimateId: string) {
    const estimate = await this.estimates.newVersion(ws, estimateId);
    return { id: estimate.id, versionNo: estimate.versionNo, status: estimate.status };
  }

  @Get('estimates/:estimateId/pdf')
  @Can('estimates.read')
  @AllowExpiredAccess()
  @Header('Content-Type', 'application/pdf')
  @ApiOperation({ summary: 'Печатная форма сметы' })
  async pdfFile(
    @Ws() ws: WorkspaceContext,
    @Param('estimateId') estimateId: string,
    @Res() res: Response,
  ): Promise<void> {
    const estimate = await this.estimates.getById(ws, estimateId);
    const order = await this.orders.findById(ws.workspaceId, estimate.orderId);
    if (!order) throw new Error('Заказ сметы не найден');

    const buffer = await this.pdf.render(estimate, {
      workspace: {
        name: ws.workspace.name,
        phone: ws.workspace.phone,
        address: ws.workspace.address,
      },
      order: { number: order.number, title: order.title },
      client: { name: order.client.name, phone: order.client.phone },
      vehicle: order.vehicle
        ? {
            make: order.vehicle.make,
            model: order.vehicle.model,
            plate: order.vehicle.plate,
            year: order.vehicle.year,
          }
        : null,
    });

    res.setHeader(
      'Content-Disposition',
      `inline; filename="estimate-${order.number}-v${estimate.versionNo}.pdf"`,
    );
    res.end(buffer);
  }
}
