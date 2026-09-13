import { Body, Controller, Post, Query, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { zodBody } from '@/common/pipes/zod-validation.pipe';
import { CurrentAuth, type AuthContext } from '@/modules/auth/decorators/auth.decorators';
import { InvitationsService } from './invitations.service';
import { acceptInvitationSchema } from './dto/workspaces.dto';

const previewQuery = z.object({ token: z.string().min(10).max(200) });

@ApiTags('workspaces')
@Controller('invitations')
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Get('preview')
  @ApiOperation({ summary: 'Что предлагает приглашение' })
  async preview(@Query() query: Record<string, string>) {
    const { token } = previewQuery.parse(query);
    return this.invitations.preview(token);
  }

  @Post('accept')
  @ApiOperation({ summary: 'Принять приглашение в мастерскую' })
  async accept(
    @CurrentAuth() auth: AuthContext,
    @Body(zodBody(acceptInvitationSchema)) body: { token: string },
  ) {
    return this.invitations.accept(body.token, { id: auth.user.id, phone: auth.user.phone });
  }
}
