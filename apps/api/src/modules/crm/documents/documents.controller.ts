import { Controller, Get, Header, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AllowExpiredAccess, Can, Workspace } from '@/modules/workspaces/guards/workspace.guard';
import { Ws } from '@/modules/workspaces/decorators/workspace.decorators';
import type { WorkspaceContext } from '@/modules/workspaces/workspace.types';
import { DocumentsService } from './documents.service';

@ApiTags('crm')
@Controller('workspaces/:workspaceId')
@Workspace()
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get('order-documents')
  @Can('orders.read_own')
  @AllowExpiredAccess()
  @ApiOperation({ summary: 'Какие документы можно распечатать по заказу' })
  list() {
    return { items: this.documents.list() };
  }

  /**
   * Печатная форма документа.
   *
   * Отдаётся `inline`, чтобы Telegram и браузер открывали PDF просмотром:
   * мастер обычно сначала смотрит документ, а печатает или сохраняет потом.
   * `?download=true` переключает на скачивание файлом.
   */
  @Get('orders/:orderId/documents/:kind/pdf')
  @Can('orders.read_own')
  @AllowExpiredAccess()
  @Header('Content-Type', 'application/pdf')
  @ApiOperation({ summary: 'Документ заказа в PDF' })
  async pdf(
    @Ws() ws: WorkspaceContext,
    @Param('orderId') orderId: string,
    @Param('kind') kind: string,
    @Res() res: Response,
    @Query('download') download?: string,
  ): Promise<void> {
    const result = await this.documents.render(ws, orderId, kind);
    res.setHeader(
      'Content-Disposition',
      `${download === 'true' ? 'attachment' : 'inline'}; filename="${result.fileName}"`,
    );
    res.end(result.buffer);
  }
}
