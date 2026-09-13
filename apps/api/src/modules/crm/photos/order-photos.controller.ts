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
import { attachPhotoSchema, updatePhotoSchema } from '../dto/crm.dto';

const CATEGORY_LABELS: Record<string, string> = {
  before: 'До',
  during: 'В процессе',
  after: 'После',
  document: 'Документы',
};

@ApiTags('crm')
@Controller('workspaces/:workspaceId/orders/:orderId/photos')
@Workspace()
export class OrderPhotosController {
  constructor(private readonly photos: OrderPhotosService) {}

  @Get()
  @Can('orders.read_own')
  @AllowExpiredAccess()
  @ApiOperation({ summary: 'Фотографии заказа по категориям' })
  async list(
    @Ws() ws: WorkspaceContext,
    @Param('orderId') orderId: string,
    @CurrentAuth() auth: AuthContext,
  ) {
    const { items } = await this.photos.listForOrder(ws, orderId, auth);
    return {
      categories: CATEGORY_LABELS,
      items: items.map((photo) => ({
        id: photo.id,
        fileId: photo.fileId,
        category: photo.category,
        categoryLabel: CATEGORY_LABELS[photo.category] ?? photo.category,
        caption: photo.caption,
        position: photo.position,
        estimateItemId: photo.estimateItemId,
        status: photo.file.status,
        width: photo.file.width,
        height: photo.file.height,
        thumbUrl: photo.thumbUrl,
        createdAt: photo.createdAt.toISOString(),
      })),
    };
  }

  @Post()
  @Can('orders.write_own')
  @Idempotent()
  @Audited({ entityType: 'order_photo', action: 'create', idFrom: { responseField: 'id' } })
  @ApiOperation({ summary: 'Привязка загруженного файла к заказу' })
  async attach(
    @Ws() ws: WorkspaceContext,
    @Param('orderId') orderId: string,
    @Body(zodBody(attachPhotoSchema)) body: Record<string, never>,
  ) {
    const photo = await this.photos.attach(ws, orderId, body as never);
    return { id: photo.id, category: photo.category, position: photo.position };
  }

  @Patch(':photoId')
  @Can('orders.write_own')
  @Audited({ entityType: 'order_photo', idFrom: { param: 'photoId' } })
  @ApiOperation({ summary: 'Категория, подпись, порядок, привязка к позиции сметы' })
  async update(
    @Ws() ws: WorkspaceContext,
    @Param('photoId') photoId: string,
    @Body(zodBody(updatePhotoSchema)) body: Record<string, never>,
  ) {
    const photo = await this.photos.update(ws, photoId, body as never);
    return { id: photo.id, category: photo.category, caption: photo.caption };
  }

  @Delete(':photoId')
  @Can('orders.write_own')
  @Audited({ entityType: 'order_photo', action: 'delete', idFrom: { param: 'photoId' } })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Удаление фотографии' })
  async remove(
    @Ws() ws: WorkspaceContext,
    @Param('photoId') photoId: string,
    @CurrentAuth() auth: AuthContext,
  ): Promise<void> {
    await this.photos.remove(ws, photoId, auth);
  }

  @Get(':photoId/download')
  @Can('orders.read_own')
  @AllowExpiredAccess()
  @ApiOperation({ summary: 'Ссылка на оригинал снимка' })
  async download(
    @Ws() ws: WorkspaceContext,
    @Param('photoId') photoId: string,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.photos.downloadUrl(ws, photoId, auth);
  }
}
