import { Injectable } from '@nestjs/common';
import type { MeResponse, MeProductAccess, MeWorkspace } from '@pdr/shared';
import { AccessService } from '@/modules/access/access.service';
import { UsersService } from '@/modules/users/users.service';
import { WorkspacesService } from '@/modules/workspaces/workspaces.service';
import { NotificationsService } from '@/modules/notifications/notifications.service';
import { CohortsService } from '@/modules/learning/cohorts/cohorts.service';
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
    private readonly cohorts: CohortsService,
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
    const enrollmentRows = await this.cohorts.listEnrollmentsOfUser(user.id);
    const courseGrants = new Map(
      grants.filter((g) => g.product === 'course' && g.courseId).map((g) => [g.courseId!, g]),
    );

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
      enrollments: enrollmentRows.map((enrollment) => {
        const grant = courseGrants.get(enrollment.cohort.courseId);
        return {
          id: enrollment.id,
          courseId: enrollment.cohort.courseId,
          courseTitle: enrollment.cohort.course.title,
          cohortId: enrollment.cohortId,
          cohortTitle: enrollment.cohort.title,
          status: enrollment.status,
          startedAt: enrollment.startedAt.toISOString(),
          hasActiveAccess: grant !== undefined,
          accessValidUntil: grant?.validUntil?.toISOString() ?? null,
        };
      }),
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
