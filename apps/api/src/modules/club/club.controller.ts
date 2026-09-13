import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentAuth, type AuthContext } from '@/modules/auth/decorators/auth.decorators';
import { ClubService } from './club.service';

@ApiTags('club')
@Controller('club')
export class ClubController {
  constructor(private readonly club: ClubService) {}

  @Get('status')
  @ApiOperation({ summary: 'Состояние членства в закрытом клубе' })
  async status(@CurrentAuth() auth: AuthContext) {
    return this.club.statusFor(auth.user.id);
  }
}
