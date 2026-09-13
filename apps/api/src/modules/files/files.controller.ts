import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { zodBody } from '@/common/pipes/zod-validation.pipe';
import { AppError } from '@/common/errors/app.error';
import { AppConfigService } from '@/config/config.service';
import { CurrentAuth, Public, type AuthContext } from '@/modules/auth/decorators/auth.decorators';
import { WorkspacesService } from '@/modules/workspaces/workspaces.service';
import { LocalStorageProvider } from '@/infra/storage/local-storage.provider';
import { FilesService } from './files.service';
import { completeUploadSchema, downloadQuerySchema, presignUploadSchema } from './dto/files.dto';

@ApiTags('files')
@Controller('files')
export class FilesController {
  constructor(
    private readonly files: FilesService,
    private readonly workspaces: WorkspacesService,
    private readonly config: AppConfigService,
    private readonly local: LocalStorageProvider,
  ) {}

  /**
   * Эндпоинт локального хранилища: эмулирует подписанные ссылки S3
   * в разработке и тестах. На staging и production драйвер local запрещён.
   */
  @Get('local')
  @Public()
  @ApiExcludeEndpoint()
  async localGet(
    @Query() query: Record<string, string>,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    this.assertLocalDriver();
    const { key, op, expires, sig, name } = query;
    if (!key || !op || !expires || !sig || op !== 'get') throw AppError.notFound('Файл не найден');
    if (!this.local.verify(key, 'get', Number(expires), sig)) {
      throw AppError.forbidden('Ссылка недействительна или истекла');
    }
    void req;
    const body = await this.local.get(key).catch(() => null);
    if (!body) throw AppError.notFound('Файл не найден');
    if (name)
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(name)}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.send(body);
  }

  @Post('local')
  @Public()
  @ApiExcludeEndpoint()
  async localPut(
    @Query() query: Record<string, string>,
    @Req() req: Request,
  ): Promise<{ ok: true }> {
    this.assertLocalDriver();
    const { key, op, expires, sig } = query;
    if (!key || op !== 'put' || !expires || !sig) throw AppError.notFound('Не найдено');
    if (!this.local.verify(key, 'put', Number(expires), sig)) {
      throw AppError.forbidden('Ссылка недействительна или истекла');
    }
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    await this.local.put(key, Buffer.concat(chunks), 'application/octet-stream');
    return { ok: true };
  }

  @Post('presign-upload')
  @ApiOperation({ summary: 'Ссылка для загрузки файла напрямую в хранилище' })
  async presign(
    @CurrentAuth() auth: AuthContext,
    @Body(zodBody(presignUploadSchema))
    body: {
      scope:
        | 'order_photo'
        | 'submission'
        | 'exam_attempt'
        | 'lesson_material'
        | 'avatar'
        | 'export'
        | 'course_cover'
        | 'question_image';
      mimeType: string;
      sizeBytes: number;
      originalName?: string | null;
      workspaceId?: string | null;
    },
  ) {
    // Право на раздел проверяется до выдачи ссылки: presign — это уже доступ.
    if (body.workspaceId) {
      await this.workspaces.buildContext(body.workspaceId, auth.user.id);
    }
    if (
      (body.scope === 'lesson_material' ||
        body.scope === 'course_cover' ||
        body.scope === 'question_image') &&
      !auth.platformRoles.includes('admin')
    ) {
      throw AppError.notFound('Раздел недоступен');
    }
    if (body.scope === 'export') {
      throw AppError.forbidden('Файлы выгрузки создаёт сервер');
    }

    return this.files.presign({
      scope: body.scope,
      mimeType: body.mimeType,
      sizeBytes: body.sizeBytes,
      originalName: body.originalName ?? null,
      workspaceId: body.workspaceId ?? null,
      ownerUserId: auth.user.id,
    });
  }

  @Post(':fileId/refresh-upload')
  @ApiOperation({ summary: 'Новая ссылка взамен истёкшей, без потери загруженного' })
  async refresh(@CurrentAuth() auth: AuthContext, @Param('fileId') fileId: string) {
    return this.files.refreshUpload(fileId, auth.user.id);
  }

  @Post(':fileId/complete')
  @ApiOperation({ summary: 'Подтверждение загрузки' })
  async complete(
    @CurrentAuth() auth: AuthContext,
    @Param('fileId') fileId: string,
    @Body(zodBody(completeUploadSchema))
    body: { parts?: { partNumber: number; etag: string }[] },
  ) {
    const file = await this.files.complete(fileId, auth.user.id, body.parts);
    return { id: file.id, status: file.status };
  }

  @Get(':fileId')
  @ApiOperation({ summary: 'Состояние файла' })
  async get(@CurrentAuth() auth: AuthContext, @Param('fileId') fileId: string) {
    const file = await this.files.getById(fileId);
    if (file.ownerUserId !== auth.user.id && !auth.platformRoles.includes('admin')) {
      // Полные метаданные видит загрузивший; остальным достаточно ссылки.
      throw AppError.notFound('Файл не найден');
    }
    return {
      id: file.id,
      status: file.status,
      mimeType: file.mimeType,
      sizeBytes: Number(file.sizeBytes),
      width: file.width,
      height: file.height,
      durationSec: file.durationSec,
      error: file.error,
    };
  }

  @Get(':fileId/url')
  @ApiOperation({ summary: 'Подписанная ссылка на файл' })
  async url(
    @CurrentAuth() auth: AuthContext,
    @Param('fileId') fileId: string,
    @Query() query: Record<string, string>,
  ) {
    const { variant } = downloadQuerySchema.parse(query);
    return this.files.downloadUrl(fileId, auth.user, auth.platformRoles, variant);
  }

  @Delete(':fileId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Удаление файла' })
  async remove(@CurrentAuth() auth: AuthContext, @Param('fileId') fileId: string): Promise<void> {
    await this.files.softDelete(fileId, auth.user, auth.platformRoles);
  }

  private assertLocalDriver(): void {
    if (this.config.env.STORAGE_DRIVER !== 'local') throw AppError.notFound('Не найдено');
  }
}
