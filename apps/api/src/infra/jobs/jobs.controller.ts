import {
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { Public } from '@/modules/auth/decorators/auth.decorators';
import { JobRunnerService } from './job-runner.service';
import { JobsService } from './jobs.service';

/**
 * Сколько времени отводится на выполнение задач за один вызов.
 *
 * Меньше предельной длительности функции: остаток нужен, чтобы корректно
 * закрыть соединения и ответить. Что не успели — останется в очереди.
 */
const TICK_BUDGET_MS = 50_000;

/**
 * Разбор очереди фоновых задач по расписанию.
 *
 * Эндпоинт вызывает планировщик Vercel (см. `crons` в `apps/api/vercel.json`).
 * Снаружи он закрыт общим секретом: планировщик присылает его заголовком
 * `Authorization`.
 */
@ApiTags('jobs')
@Public()
@Controller('jobs')
export class JobsController {
  constructor(
    private readonly runner: JobRunnerService,
    private readonly jobs: JobsService,
  ) {}

  private assertCronSecret(req: Request): void {
    const expected = process.env.CRON_SECRET ?? '';
    if (!expected) {
      throw new ForbiddenException('CRON_SECRET не задан');
    }

    const header = req.headers.authorization ?? '';
    const provided = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';

    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new ForbiddenException('Неверный секрет планировщика');
    }
  }

  // Планировщик Vercel ходит методом GET.
  @Get('tick')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Разбор очереди фоновых задач (планировщик)' })
  async tickGet(@Req() req: Request): Promise<Record<string, number>> {
    return this.tick(req);
  }

  @Post('tick')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Разбор очереди фоновых задач (ручной запуск)' })
  async tick(@Req() req: Request): Promise<Record<string, number>> {
    this.assertCronSecret(req);
    const result = await this.runner.tick(TICK_BUDGET_MS);
    return { ...result };
  }

  @Get('stats')
  @ApiOperation({ summary: 'Размеры очереди' })
  async stats(@Req() req: Request): Promise<Record<string, number>> {
    this.assertCronSecret(req);
    return this.jobs.queueSizes();
  }
}
