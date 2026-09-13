import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { miniAppLoginSchema, refreshSchema, widgetLoginSchema } from '@pdr/shared';
import { z } from 'zod';
import type { Request } from 'express';
import { zodBody } from '@/common/pipes/zod-validation.pipe';
import { RateLimit, RateLimitGuard } from '@/common/guards/rate-limit.guard';
import { AuthService, type RequestMeta } from './auth.service';
import { SessionService } from './session.service';
import { DemoLoginService } from './demo-login.service';
import { CurrentAuth, Public, type AuthContext } from './decorators/auth.decorators';

const demoLoginSchema = z
  .object({
    key: z.string().min(1).max(40),
    secret: z.string().max(200).nullable().optional(),
  })
  .strict();

function meta(req: Request): RequestMeta {
  const forwarded = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim();
  return { userAgent: req.headers['user-agent'] ?? null, ip: forwarded ?? req.ip ?? null };
}

interface TokensResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

@ApiTags('auth')
@Controller('auth')
@UseGuards(RateLimitGuard)
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly demo: DemoLoginService,
  ) {}

  @Get('demo/accounts')
  @Public()
  @RateLimit({ limit: 60, windowSec: 60 })
  @ApiOperation({ summary: 'Демо-аккаунты staging (только вне production)' })
  async demoAccounts(@Req() req: Request) {
    const secret = (req.query.secret as string | undefined) ?? null;
    return this.demo.accounts(secret);
  }

  @Post('demo/login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 30, windowSec: 60 })
  @ApiOperation({ summary: 'Вход демо-аккаунтом без Telegram (только вне production)' })
  async demoLogin(
    @Body(zodBody(demoLoginSchema)) body: { key: string; secret?: string | null },
    @Req() req: Request,
  ): Promise<TokensResponse> {
    const issued = await this.demo.login(body.key, meta(req), body.secret);
    return {
      accessToken: issued.accessToken,
      refreshToken: issued.refreshToken,
      expiresIn: issued.expiresIn,
    };
  }

  @Post('telegram/miniapp')
  @Public()
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 30, windowSec: 60 })
  @ApiOperation({ summary: 'Вход из Mini App по initData' })
  async loginMiniApp(
    @Body(zodBody(miniAppLoginSchema)) body: { initData: string },
    @Req() req: Request,
  ): Promise<TokensResponse & { startAction: string | null }> {
    const result = await this.auth.loginWithInitData(body.initData, meta(req));
    return {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresIn: result.expiresIn,
      startAction: result.startAction,
    };
  }

  @Post('telegram/widget')
  @Public()
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 20, windowSec: 60 })
  @ApiOperation({ summary: 'Вход в админку через Telegram Login Widget' })
  async loginWidget(
    @Body(zodBody(widgetLoginSchema)) body: Record<string, unknown>,
    @Req() req: Request,
  ): Promise<TokensResponse> {
    const result = await this.auth.loginWithWidget(body, meta(req));
    return {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresIn: result.expiresIn,
    };
  }

  @Post('web/request')
  @Public()
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 10, windowSec: 60 })
  @ApiOperation({ summary: 'Запрос входа в админку с подтверждением в боте' })
  async webRequest(@Req() req: Request): Promise<{ code: string; expiresAt: string }> {
    const { code, expiresAt } = await this.auth.createWebLoginRequest(meta(req));
    return { code, expiresAt: expiresAt.toISOString() };
  }

  @Get('web/status/:code')
  @Public()
  @RateLimit({ limit: 120, windowSec: 60 })
  @ApiOperation({ summary: 'Опрос статуса запроса входа' })
  async webStatus(
    @Param('code') code: string,
    @Req() req: Request,
  ): Promise<{ status: string } & Partial<TokensResponse>> {
    const result = await this.auth.pollWebLoginRequest(code, meta(req));
    if (result.status !== 'confirmed') return { status: result.status };
    return {
      status: 'confirmed',
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresIn: result.expiresIn,
    };
  }

  @Post('refresh')
  @Public()
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 60, windowSec: 60 })
  @ApiOperation({ summary: 'Обновление пары токенов с ротацией' })
  async refresh(
    @Body(zodBody(refreshSchema)) body: { refreshToken: string },
    @Req() req: Request,
  ): Promise<TokensResponse> {
    const issued = await this.auth.refresh(body.refreshToken, meta(req));
    return {
      accessToken: issued.accessToken,
      refreshToken: issued.refreshToken,
      expiresIn: issued.expiresIn,
    };
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Завершение текущей сессии' })
  async logout(@CurrentAuth() auth: AuthContext): Promise<void> {
    await this.sessions.revoke(auth.session.id, 'logout');
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Завершение всех сессий пользователя' })
  async logoutAll(@CurrentAuth() auth: AuthContext): Promise<{ revoked: number }> {
    const revoked = await this.sessions.revokeAllForUser(auth.user.id, 'logout_all');
    return { revoked };
  }

  @Get('sessions')
  @ApiOperation({ summary: 'Активные сессии пользователя' })
  async listSessions(@CurrentAuth() auth: AuthContext): Promise<
    {
      id: string;
      kind: string;
      createdAt: string;
      lastUsedAt: string;
      current: boolean;
      userAgent: string | null;
    }[]
  > {
    const sessions = await this.sessions.listActive(auth.user.id);
    return sessions.map((s) => ({
      id: s.id,
      kind: s.kind,
      createdAt: s.createdAt.toISOString(),
      lastUsedAt: s.lastUsedAt.toISOString(),
      current: s.id === auth.session.id,
      userAgent: s.userAgent,
    }));
  }
}

export const revokeSessionSchema = z.object({ sessionId: z.string().uuid() });
