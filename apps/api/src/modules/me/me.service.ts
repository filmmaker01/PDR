import { Injectable } from '@nestjs/common';
import type { MeResponse, MeProductAccess, MeWorkspace } from '@pdr/shared';
import { AccessService } from '@/modules/access/access.service';
import { UsersService } from '@/modules/users/users.service';
import { WorkspacesService } from '@/modules/workspaces/workspaces.service';
import { NotificationsService } from '@/modules/notifications/notifications.service';
import type { AuthContext } from '@/modules/auth/decorators/auth.decorators';

/**
 * Полный контекст пользователя для клиента.
 * Ответ используется интерфейсом только для отрисовки: источником истины
 * остаются проверки на сервере при каждом обращении.
 */
@Injectable()
export class MeService {
  constructor(
    private readonly users: UsersService,
    private readonly workspaces: WorkspacesService,
    private readonly access: AccessService,
    private readonly notifications: NotificationsService,
  ) {}

  async build(auth: AuthContext): Promise<MeResponse> {
    const user = auth.user;
    const memberships = await this.workspaces.listMembershipsOf(user.id);
    const grants = await this.access.listActiveForUser(
      user.id,
      memberships.map((m) => m.workspace.id),
    );

    const workspaces: MeWorkspace[] = memberships.map((m) => ({
      id: m.workspace.id,
      name: m.workspace.name,
      role: m.member.role,
      memberId: m.member.id,
      timezone: m.workspace.timezone,
      currency: m.workspace.currency,
      hasActiveAccess: m.hasActiveAccess,
      accessValidUntil: m.accessValidUntil?.toISOString() ?? null,
    }));

    const products: MeProductAccess[] = grants.map((g) => ({
      product: g.product,
      courseId: g.courseId,
      workspaceId: g.workspaceId,
      validUntil: g.validUntil?.toISOString() ?? null,
      status: g.status,
    }));

    const clubGrant = grants.find((g) => g.product === 'club');
    const prefs = await this.notifications.preferences(user.id);

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
      workspaces,
      // Зачисления подключаются на этапе 6 вместе с модулем обучения.
      enrollments: [],
      products,
      club: {
        hasAccess: clubGrant !== undefined,
        validUntil: clubGrant?.validUntil?.toISOString() ?? null,
        status: 'none',
      },
      notifications: {
        reviewResults: prefs.reviewResults,
        stageUnlocked: prefs.stageUnlocked,
        appointmentReminders: prefs.appointmentReminders,
        orderAssigned: prefs.orderAssigned,
        accessExpiring: prefs.accessExpiring,
        reviewQueueDigest: prefs.reviewQueueDigest,
        reminderLeadMinutes: prefs.reminderLeadMinutes,
      },
    };
  }

  async updateProfile(
    userId: string,
    input: { phone?: string | null; email?: string | null; languageCode?: string | null },
  ): Promise<void> {
    await this.users.updateProfile(userId, input);
  }
}
