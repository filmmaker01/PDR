import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Idempotent } from '@/common/interceptors/idempotency.interceptor';
import { zodBody } from '@/common/pipes/zod-validation.pipe';
import { CurrentAuth, type AuthContext } from '@/modules/auth/decorators/auth.decorators';
import { Audited } from '@/modules/audit/audit.interceptor';
import { AllowExpiredAccess, Can, Workspace } from '@/modules/workspaces/guards/workspace.guard';
import { Ws } from '@/modules/workspaces/decorators/workspace.decorators';
import type { WorkspaceContext } from '@/modules/workspaces/workspace.types';
import { OrderPhotosService } from './order-photos.service';
import { PHOTO_CATEGORY_LABELS, serializePhoto } from '../serializers';
import { attachPhotoSchema, updatePhotoSchema } from '../dto/crm.dto';
import { attachLeadPhotoSchema, photoMarkupSchema } from '../dto/leads.dto';

@ApiTags('crm')
@Controller('workspaces/:workspaceId')
@Workspace()
export class OrderPhotosController {
  constructor(private readonly photos: OrderPhotosService) {}

  // ── Фотографии заказа ─────────────────────────────────────────────────────

  @Get('orders/:orderId/photos')
  @Can('orders.read_own')
  @AllowExpiredAccess()
  @ApiOperation({ summary: 'Фотографии заказа по категориям' })
  async list(
    @Ws() ws: WorkspaceContext,
    @Param('orderId') orderId: string,
    @CurrentAuth() auth: AuthContext,
  ) {
    const { items } = await this.photos.listFor(ws, { orderId }, auth);
    return { categories: PHOTO_CATEGORY_LABELS, items: items.map(serializePhoto) };
  }

  @Post('orders/:orderId/photos')
  @Can('orders.write_own')
  @Idempotent()
  @Audited({ entityType: 'order_photo', action: 'create', idFrom: { responseField: 'id' } })
  @ApiOperation({ summary: 'Привязка загруженного файла к заказу' })
  async attach(
    @Ws() ws: WorkspaceContext,
    @Param('orderId') orderId: string,
    @Body(zodBody(attachPhotoSchema)) body: Record<string, never>,
  ) {
    const photo = await this.photos.attach(ws, { orderId }, body as never);
    return { id: photo.id, category: photo.category, position: photo.position };
  }

  // ── Фотографии обращения ──────────────────────────────────────────────────

  @Post('leads/:leadId/photos')
  @Can('leads.write')
  @Idempotent()
  @Audited({ entityType: 'order_photo', action: 'create', idFrom: { responseField: 'id' } })
  @ApiOperation({ summary: 'Привязка загруженного файла к обращению' })
  async attachToLead(
    @Ws() ws: WorkspaceContext,
    @Param('leadId') leadId: string,
    @Body(zodBody(attachLeadPhotoSchema)) body: Record<string, never>,
  ) {
    const photo = await this.photos.attach(ws, { leadId }, body as never);
    return { id: photo.id, category: photo.category, position: photo.position };
  }

  // ── Общее для обоих владельцев ────────────────────────────────────────────
  //
  // Право на маршруте минимальное: по одному идентификатору снимка неизвестно,
  // чей он. Настоящую проверку делает сервис, который знает владельца.

  @Patch('photos/:photoId')
  @Can('workspace.read')
  @Audited({ entityType: 'order_photo', idFrom: { param: 'photoId' } })
  @ApiOperation({ summary: 'Категория, подпись, порядок, привязка к повреждению и смете' })
  async update(
    @Ws() ws: WorkspaceContext,
    @Param('photoId') photoId: string,
    @Body(zodBody(updatePhotoSchema)) body: Record<string, never>,
  ) {
    const photo = await this.photos.update(ws, photoId, body as never);
    return { id: photo.id, category: photo.category, caption: photo.caption };
  }

  @Post('photos/:photoId/markup')
  @Can('workspace.read')
  @Audited({ entityType: 'order_photo', action: 'markup', idFrom: { param: 'photoId' } })
  @ApiOperation({ summary: 'Разметка повреждения на снимке. Оригинал не меняется' })
  async markup(
    @Ws() ws: WorkspaceContext,
    @Param('photoId') photoId: string,
    @Body(zodBody(photoMarkupSchema)) body: Record<string, never>,
    @CurrentAuth() auth: AuthContext,
  ) {
    const photo = await this.photos.saveMarkup(ws, photoId, body as never, auth);
    return {
      id: photo.id,
      annotatedAt: photo.annotatedAt?.toISOString() ?? null,
      annotationFileId: photo.annotationFileId,
    };
  }

  @Delete('photos/:photoId')
  @Can('workspace.read')
  @Audited({ entityType: 'order_photo', action: 'delete', idFrom: { param: 'photoId' } })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Удаление фотографии вместе с разметкой' })
  async remove(
    @Ws() ws: WorkspaceContext,
    @Param('photoId') photoId: string,
    @CurrentAuth() auth: AuthContext,
  ): Promise<void> {
    await this.photos.remove(ws, photoId, auth);
  }

  @Get('photos/:photoId/download')
  @Can('workspace.read')
  @AllowExpiredAccess()
  @ApiOperation({ summary: 'Ссылка на оригинал снимка' })
  async download(
    @Ws() ws: WorkspaceContext,
    @Param('photoId') photoId: string,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.photos.downloadUrl(ws, photoId, auth, 'original');
  }

  @Get('photos/:photoId/download/markup')
  @Can('workspace.read')
  @AllowExpiredAccess()
  @ApiOperation({ summary: 'Ссылка на снимок с нанесённой разметкой' })
  async downloadMarkup(
    @Ws() ws: WorkspaceContext,
    @Param('photoId') photoId: string,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.photos.downloadUrl(ws, photoId, auth, 'annotation');
  }

  // ── Прежние адреса ────────────────────────────────────────────────────────
  //
  // Mini App и веб-админка уже ходят по ним; оставлены, чтобы обновление
  // backend не ломало открытые сессии.

  @Patch('orders/:orderId/photos/:photoId')
  @Can('orders.write_own')
  @Audited({ entityType: 'order_photo', idFrom: { param: 'photoId' } })
  @ApiOperation({ summary: 'Прежний адрес правки снимка заказа' })
  async updateInOrder(
    @Ws() ws: WorkspaceContext,
    @Param('photoId') photoId: string,
    @Body(zodBody(updatePhotoSchema)) body: Record<string, never>,
  ) {
    return this.update(ws, photoId, body);
  }

  @Delete('orders/:orderId/photos/:photoId')
  @Can('orders.write_own')
  @Audited({ entityType: 'order_photo', action: 'delete', idFrom: { param: 'photoId' } })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Прежний адрес удаления снимка заказа' })
  async removeInOrder(
    @Ws() ws: WorkspaceContext,
    @Param('photoId') photoId: string,
    @CurrentAuth() auth: AuthContext,
  ): Promise<void> {
    await this.photos.remove(ws, photoId, auth);
  }

  @Get('orders/:orderId/photos/:photoId/download')
  @Can('orders.read_own')
  @AllowExpiredAccess()
  @ApiOperation({ summary: 'Прежний адрес ссылки на оригинал' })
  async downloadInOrder(
    @Ws() ws: WorkspaceContext,
    @Param('photoId') photoId: string,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.photos.downloadUrl(ws, photoId, auth, 'original');
  }
}
