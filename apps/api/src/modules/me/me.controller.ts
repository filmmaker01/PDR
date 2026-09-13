import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { updateMeSchema, type MeResponse } from '@pdr/shared';
import { zodBody } from '@/common/pipes/zod-validation.pipe';
import { UsersService } from '@/modules/users/users.service';
import { CurrentAuth, type AuthContext } from '@/modules/auth/decorators/auth.decorators';
import { MeService } from './me.service';

@ApiTags('me')
@Controller('me')
export class MeController {
  constructor(
    private readonly me: MeService,
    private readonly users: UsersService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Профиль, роли, мастерские, зачисления и доступы' })
  async get(@CurrentAuth() auth: AuthContext): Promise<MeResponse> {
    return this.me.build(auth);
  }

  @Patch()
  @ApiOperation({ summary: 'Обновление профиля' })
  async update(
    @CurrentAuth() auth: AuthContext,
    @Body(zodBody(updateMeSchema))
    body: { phone?: string | null; email?: string | null; languageCode?: string | null },
  ): Promise<MeResponse> {
    await this.me.updateProfile(auth.user.id, body);
    const user = await this.users.getById(auth.user.id);
    return this.me.build({ ...auth, user });
  }

  @Post('bot-write-allowed')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Пользователь разрешил боту писать сообщения' })
  async allowBotWrite(@CurrentAuth() auth: AuthContext): Promise<void> {
    await this.users.markBotWriteAllowed(auth.user.id);
  }
}
