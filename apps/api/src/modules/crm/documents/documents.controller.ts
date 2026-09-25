import { Controller, Get, Header, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AllowExpiredAccess, Can, Workspace } from '@/modules/workspaces/guards/workspace.guard';
import { Ws } from '@/modules/workspaces/decorators/workspace.decorators';
import type { WorkspaceContext } from '@/modules/workspaces/workspace.types';
import { RateLimit } from '@/common/guards/rate-limit.guard';
import { Public } from '@/modules/auth/decorators/auth.decorators';
import { Audited } from '@/modules/audit/audit.interceptor';
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

  /**
   * Ссылка на документ для клиента — её мастер сам вставляет в сообщение.
   * Сервер ничего клиенту не отправляет.
   */
  @Post('orders/:orderId/documents/:kind/share')
  @Can('orders.read_own')
  @Audited({ entityType: 'order', action: 'document_share', idFrom: { param: 'orderId' } })
  @ApiOperation({ summary: 'Временная ссылка на документ заказа для клиента' })
  async share(
    @Ws() ws: WorkspaceContext,
    @Param('orderId') orderId: string,
    @Param('kind') kind: string,
  ) {
    return this.documents.share(ws, orderId, kind);
  }
}

/** Документ по ссылке, которую мастер отправил клиенту: без входа, только чтение. */
@ApiTags('crm')
@Controller('shared')
export class SharedDocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get('documents/:token')
  @Public()
  @RateLimit({ limit: 30, windowSec: 60 })
  @Header('Content-Type', 'application/pdf')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Robots-Tag', 'noindex')
  @ApiOperation({ summary: 'Документ заказа по временной ссылке для клиента' })
  async pdf(@Param('token') token: string, @Res() res: Response): Promise<void> {
    const result = await this.documents.renderShared(token);
    res.setHeader('Content-Disposition', `inline; filename="${result.fileName}"`);
    res.end(result.buffer);
  }
}
