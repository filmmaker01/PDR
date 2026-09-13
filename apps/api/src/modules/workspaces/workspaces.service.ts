import { Injectable } from '@nestjs/common';
import type { Prisma, Workspace, WorkspaceMember, WorkspaceRole } from '@prisma/client';
import { isValidTimeZone, permissionsFor } from '@pdr/shared';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { AppError } from '@/common/errors/app.error';
import { AccessService } from '@/modules/access/access.service';
import {
  DEFAULT_WORKSPACE_SETTINGS,
  type WorkspaceContext,
  type WorkspaceSettings,
} from './workspace.types';

export interface MembershipSummary {
  workspace: Workspace;
  member: WorkspaceMember;
  hasActiveAccess: boolean;
  accessValidUntil: Date | null;
}

@Injectable()
export class WorkspacesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
  ) {}

  static settingsOf(workspace: Workspace): WorkspaceSettings {
    return { ...DEFAULT_WORKSPACE_SETTINGS, ...((workspace.settings as object) ?? {}) };
  }

  /**
   * Сборка контекста мастерской: членство, права, состояние доступа.
   * Отсутствие членства — 404, а не 403: существование мастерской не раскрывается.
   */
  async buildContext(workspaceId: string, userId: string): Promise<WorkspaceContext> {
    const member = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      include: { workspace: true },
    });
    if (!member || !member.isActive || member.workspace.archivedAt) {
      throw AppError.notFound('Мастерская не найдена');
    }

    const access = await this.access.check({ product: 'crm', workspaceId });
    const settings = WorkspacesService.settingsOf(member.workspace);
    const { workspace, ...memberOnly } = member;

    return {
      workspaceId,
      workspace,
      member: memberOnly as WorkspaceMember,
      role: member.role,
      userId,
      settings,
      permissions: permissionsFor(member.role, settings),
      hasActiveAccess: access.granted,
      accessValidUntil: access.validUntil,
    };
  }

  async listMembershipsOf(userId: string): Promise<MembershipSummary[]> {
    const members = await this.prisma.workspaceMember.findMany({
      where: { userId, isActive: true, workspace: { archivedAt: null } },
      include: { workspace: true },
      orderBy: { joinedAt: 'asc' },
    });
    if (members.length === 0) return [];

    const grants = await this.access.listActiveForUser(
      userId,
      members.map((m) => m.workspaceId),
    );
    const byWorkspace = new Map(
      grants.filter((g) => g.product === 'crm' && g.workspaceId).map((g) => [g.workspaceId!, g]),
    );

    return members.map(({ workspace, ...member }) => ({
      workspace,
      member: member as WorkspaceMember,
      hasActiveAccess: byWorkspace.has(workspace.id),
      accessValidUntil: byWorkspace.get(workspace.id)?.validUntil ?? null,
    }));
  }

  async create(input: {
    name: string;
    ownerUserId: string;
    timezone?: string;
    currency?: string;
    createdById: string;
  }): Promise<Workspace> {
    if (input.timezone && !isValidTimeZone(input.timezone)) {
      throw AppError.validation('Неизвестный часовой пояс');
    }
    return this.prisma.transaction(async (tx) => {
      const workspace = await tx.workspace.create({
        data: {
          name: input.name,
          timezone: input.timezone ?? 'Europe/Moscow',
          currency: input.currency ?? 'RUB',
          createdById: input.createdById,
          settings: DEFAULT_WORKSPACE_SETTINGS as unknown as Prisma.InputJsonValue,
        },
      });
      await tx.workspaceMember.create({
        data: { workspaceId: workspace.id, userId: input.ownerUserId, role: 'owner' },
      });
      return workspace;
    });
  }

  async update(
    workspaceId: string,
    input: {
      name?: string;
      timezone?: string;
      currency?: string;
      phone?: string | null;
      address?: string | null;
      settings?: Partial<WorkspaceSettings>;
    },
  ): Promise<Workspace> {
    if (input.timezone && !isValidTimeZone(input.timezone)) {
      throw AppError.validation('Неизвестный часовой пояс');
    }
    const current = await this.getById(workspaceId);
    const settings = input.settings
      ? { ...WorkspacesService.settingsOf(current), ...input.settings }
      : undefined;

    return this.prisma.workspace.update({
      where: { id: workspaceId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
        ...(input.currency !== undefined ? { currency: input.currency } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        ...(input.address !== undefined ? { address: input.address } : {}),
        ...(settings ? { settings: settings as unknown as Prisma.InputJsonValue } : {}),
      },
    });
  }

  async getById(workspaceId: string): Promise<Workspace> {
    const workspace = await this.prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!workspace) throw AppError.notFound('Мастерская не найдена');
    return workspace;
  }

  async listMembers(workspaceId: string): Promise<
    (WorkspaceMember & {
      user: { firstName: string; lastName: string | null; username: string | null };
    })[]
  > {
    return this.prisma.workspaceMember.findMany({
      where: { workspaceId },
      include: { user: { select: { firstName: true, lastName: true, username: true } } },
      orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
    });
  }

  async updateMember(
    workspaceId: string,
    memberId: string,
    input: { displayName?: string | null; color?: string | null; isActive?: boolean },
  ): Promise<WorkspaceMember> {
    const member = await this.prisma.workspaceMember.findFirst({
      where: { id: memberId, workspaceId },
    });
    if (!member) throw AppError.notFound('Сотрудник не найден');
    if (member.role === 'owner' && input.isActive === false) {
      throw AppError.conflict('Нельзя деактивировать владельца. Сначала передайте владение');
    }

    return this.prisma.workspaceMember.update({
      where: { id: memberId },
      data: {
        ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
        ...(input.color !== undefined ? { color: input.color } : {}),
        ...(input.isActive !== undefined
          ? { isActive: input.isActive, leftAt: input.isActive ? null : new Date() }
          : {}),
      },
    });
  }

  /** Передача владения выполняется одной транзакцией: двух владельцев не бывает. */
  async transferOwnership(
    workspaceId: string,
    currentOwnerUserId: string,
    newOwnerMemberId: string,
  ): Promise<void> {
    await this.prisma.transaction(async (tx) => {
      const current = await tx.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId, userId: currentOwnerUserId } },
      });
      if (!current || current.role !== 'owner') {
        throw AppError.forbidden('Передать владение может только владелец');
      }
      const next = await tx.workspaceMember.findFirst({
        where: { id: newOwnerMemberId, workspaceId, isActive: true },
      });
      if (!next) throw AppError.notFound('Сотрудник не найден');
      if (next.id === current.id) throw AppError.conflict('Вы уже владелец');

      // Сначала понижаем текущего, иначе частичный уникальный индекс не пропустит.
      await tx.workspaceMember.update({ where: { id: current.id }, data: { role: 'employee' } });
      await tx.workspaceMember.update({ where: { id: next.id }, data: { role: 'owner' } });
    });
  }

  async findMemberByUser(workspaceId: string, userId: string): Promise<WorkspaceMember | null> {
    return this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
    });
  }

  async addMember(
    workspaceId: string,
    userId: string,
    role: WorkspaceRole,
  ): Promise<WorkspaceMember> {
    const existing = await this.findMemberByUser(workspaceId, userId);
    if (existing) {
      if (existing.isActive) throw AppError.conflict('Пользователь уже в мастерской');
      return this.prisma.workspaceMember.update({
        where: { id: existing.id },
        data: { isActive: true, leftAt: null, role },
      });
    }
    return this.prisma.workspaceMember.create({ data: { workspaceId, userId, role } });
  }

  /** Следующий номер заказа внутри мастерской (атомарно). */
  async nextOrderNumber(workspaceId: string, tx?: Prisma.TransactionClient): Promise<number> {
    const client = tx ?? this.prisma;
    const updated = await client.workspace.update({
      where: { id: workspaceId },
      data: { orderSeq: { increment: 1 } },
      select: { orderSeq: true },
    });
    return updated.orderSeq;
  }
}
