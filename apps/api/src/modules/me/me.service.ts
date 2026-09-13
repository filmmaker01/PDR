import { Injectable } from '@nestjs/common';
import type { MeResponse } from '@pdr/shared';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { UsersService } from '@/modules/users/users.service';
import type { AuthContext } from '@/modules/auth/decorators/auth.decorators';

/**
 * Сборка полного контекста пользователя для клиента.
 * Разделы (мастерские, зачисления, доступы, клуб, уведомления) подключаются
 * по мере появления соответствующих модулей; клиент использует их только
 * для отрисовки — источником истины остаются проверки на сервере.
 */
@Injectable()
export class MeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
  ) {}

  async build(auth: AuthContext): Promise<MeResponse> {
    const user = auth.user;
    void this.prisma;

    return {
      user: {
        id: user.id,
        telegramUserId: user.telegramUserId.toString(),
        firstName: user.firstName,
        lastName: user.lastName,
        username: user.username,
        phone: user.phone,
        photoUrl: user.photoUrl,
        botWriteAllowed: user.botWriteAllowed,
        languageCode: user.languageCode,
      },
      platformRoles: auth.platformRoles,
      workspaces: [],
      enrollments: [],
      products: [],
      club: { hasAccess: false, validUntil: null, status: 'none' },
      notifications: {},
    };
  }

  async updateProfile(
    userId: string,
    input: { phone?: string | null; email?: string | null; languageCode?: string | null },
  ): Promise<void> {
    await this.users.updateProfile(userId, input);
  }
}
