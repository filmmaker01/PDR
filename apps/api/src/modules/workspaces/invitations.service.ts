import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type { WorkspaceInvitation, WorkspaceRole } from '@prisma/client';
import { normalizePhone } from '@pdr/shared';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { AppError } from '@/common/errors/app.error';
import { WorkspacesService } from './workspaces.service';

const MAX_INVITATION_DAYS = 30;

export interface CreatedInvitation {
  invitation: WorkspaceInvitation;
  /** Токен возвращается один раз: в базе хранится только его хеш. */
  token: string;
  startParam: string;
}

@Injectable()
export class InvitationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
  ) {}

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  async create(input: {
    workspaceId: string;
    role: WorkspaceRole;
    createdById: string;
    expiresInDays?: number;
    phone?: string | null;
    note?: string | null;
  }): Promise<CreatedInvitation> {
    if (input.role === 'owner') {
      throw AppError.validation('Владельца нельзя пригласить. Используйте передачу владения');
    }
    const days = Math.min(Math.max(input.expiresInDays ?? 7, 1), MAX_INVITATION_DAYS);
    const token = randomBytes(18).toString('base64url');
    const phone = input.phone ? normalizePhone(input.phone) : null;
    if (input.phone && !phone) throw AppError.validation('Не удалось разобрать номер телефона');

    const invitation = await this.prisma.workspaceInvitation.create({
      data: {
        workspaceId: input.workspaceId,
        role: input.role,
        tokenHash: this.hash(token),
        invitedPhone: phone,
        note: input.note ?? null,
        createdById: input.createdById,
        expiresAt: new Date(Date.now() + days * 86_400_000),
      },
    });

    return { invitation, token, startParam: `inv_${token}` };
  }

  async listActive(workspaceId: string): Promise<WorkspaceInvitation[]> {
    return this.prisma.workspaceInvitation.findMany({
      where: {
        workspaceId,
        revokedAt: null,
        acceptedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async revoke(workspaceId: string, invitationId: string): Promise<void> {
    const result = await this.prisma.workspaceInvitation.updateMany({
      where: { id: invitationId, workspaceId, revokedAt: null, acceptedAt: null },
      data: { revokedAt: new Date() },
    });
    if (result.count === 0) throw AppError.notFound('Приглашение не найдено');
  }

  /** Сведения о приглашении до принятия: что именно предлагают. */
  async preview(token: string): Promise<{
    workspaceName: string;
    role: WorkspaceRole;
    requiresPhone: boolean;
  }> {
    const invitation = await this.findUsable(token);
    const workspace = await this.workspaces.getById(invitation.workspaceId);
    return {
      workspaceName: workspace.name,
      role: invitation.role,
      requiresPhone: invitation.invitedPhone !== null,
    };
  }

  async accept(
    token: string,
    user: { id: string; phone: string | null },
  ): Promise<{ workspaceId: string; role: WorkspaceRole }> {
    const invitation = await this.findUsable(token);

    if (invitation.invitedPhone) {
      if (!user.phone) {
        throw AppError.validation(
          'Приглашение выдано на конкретный номер. Укажите телефон в профиле',
        );
      }
      if (normalizePhone(user.phone) !== invitation.invitedPhone) {
        throw AppError.forbidden('Приглашение выдано на другой номер телефона');
      }
    }

    return this.prisma.transaction(async (tx) => {
      const claimed = await tx.workspaceInvitation.updateMany({
        where: { id: invitation.id, acceptedAt: null, revokedAt: null },
        data: { acceptedAt: new Date(), acceptedById: user.id },
      });
      if (claimed.count === 0) throw AppError.conflict('Приглашение уже использовано');

      const existing = await tx.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: invitation.workspaceId, userId: user.id } },
      });
      if (existing) {
        if (!existing.isActive) {
          await tx.workspaceMember.update({
            where: { id: existing.id },
            data: { isActive: true, leftAt: null, role: invitation.role },
          });
        }
      } else {
        await tx.workspaceMember.create({
          data: {
            workspaceId: invitation.workspaceId,
            userId: user.id,
            role: invitation.role,
          },
        });
      }
      return { workspaceId: invitation.workspaceId, role: invitation.role };
    });
  }

  private async findUsable(token: string): Promise<WorkspaceInvitation> {
    const invitation = await this.prisma.workspaceInvitation.findUnique({
      where: { tokenHash: this.hash(token) },
    });
    if (!invitation || invitation.revokedAt) {
      throw AppError.notFound('Приглашение не найдено или отозвано');
    }
    if (invitation.acceptedAt) throw AppError.conflict('Приглашение уже использовано');
    if (invitation.expiresAt.getTime() <= Date.now()) {
      throw AppError.notFound('Срок приглашения истёк');
    }
    return invitation;
  }
}
