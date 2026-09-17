import { Injectable } from '@nestjs/common';
import { ownsRecord } from '@pdr/shared';
import { AppError } from '@/common/errors/app.error';
import type { WorkspaceContext } from '@/modules/workspaces/workspace.types';
import { LeadsRepository, type LeadWithRelations } from '../repositories/leads.repository';
import { OrdersRepository, type OrderWithRelations } from '../repositories/orders.repository';

/**
 * Повреждения, фотографии и оценки живут либо у обращения, либо у заказа.
 * Проверка «кому это видно и кто может это править» у них одна и та же,
 * поэтому она собрана здесь: три копии разошлись бы при первой же правке
 * прав, и сотрудник увидел бы чужое обращение.
 */
export type CrmParent = { leadId: string } | { orderId: string };

export function isLeadParent(parent: CrmParent): parent is { leadId: string } {
  return 'leadId' in parent;
}

@Injectable()
export class CrmParentAccess {
  constructor(
    private readonly leads: LeadsRepository,
    private readonly orders: OrdersRepository,
  ) {}

  async readableLead(ctx: WorkspaceContext, leadId: string): Promise<LeadWithRelations> {
    if (!ctx.permissions.has('leads.read')) {
      throw AppError.forbidden('Недостаточно прав для просмотра обращений');
    }
    const lead = await this.leads.findById(ctx.workspaceId, leadId);
    if (!lead) throw AppError.notFound('Обращение не найдено');
    // Право видеть чужие обращения идёт вместе с правом видеть чужие заказы:
    // разделять их незачем, это один и тот же вопрос доверия внутри мастерской.
    if (!ctx.permissions.has('orders.read_all')) {
      if (!ownsRecord({ memberId: ctx.member.id, userId: ctx.userId }, lead)) {
        throw AppError.notFound('Обращение не найдено');
      }
    }
    return lead;
  }

  async writableLead(ctx: WorkspaceContext, leadId: string): Promise<LeadWithRelations> {
    const lead = await this.readableLead(ctx, leadId);
    if (!ctx.permissions.has('leads.write')) {
      throw AppError.forbidden('Недостаточно прав для изменения обращений');
    }
    if (lead.archivedAt) {
      throw AppError.validation('Обращение в архиве: восстановите его, чтобы продолжить работу');
    }
    return lead;
  }

  async readableOrder(ctx: WorkspaceContext, orderId: string): Promise<OrderWithRelations> {
    const order = await this.orders.findById(ctx.workspaceId, orderId);
    if (!order) throw AppError.notFound('Заказ не найден');
    if (!ctx.permissions.has('orders.read_all')) {
      if (!ownsRecord({ memberId: ctx.member.id, userId: ctx.userId }, order)) {
        throw AppError.notFound('Заказ не найден');
      }
    }
    return order;
  }

  async writableOrder(ctx: WorkspaceContext, orderId: string): Promise<OrderWithRelations> {
    const order = await this.readableOrder(ctx, orderId);
    if (ctx.permissions.has('orders.write_all')) return order;
    if (!ownsRecord({ memberId: ctx.member.id, userId: ctx.userId }, order)) {
      throw AppError.notFound('Заказ не найден');
    }
    return order;
  }

  async assertReadable(ctx: WorkspaceContext, parent: CrmParent): Promise<void> {
    if (isLeadParent(parent)) await this.readableLead(ctx, parent.leadId);
    else await this.readableOrder(ctx, parent.orderId);
  }

  async assertWritable(ctx: WorkspaceContext, parent: CrmParent): Promise<void> {
    if (isLeadParent(parent)) await this.writableLead(ctx, parent.leadId);
    else await this.writableOrder(ctx, parent.orderId);
  }

  /** Валюта карточки: у обращения и заказа она своя и не пересчитывается. */
  async currencyOf(ctx: WorkspaceContext, parent: CrmParent): Promise<string> {
    if (isLeadParent(parent)) {
      const lead = await this.readableLead(ctx, parent.leadId);
      return lead.currency;
    }
    const order = await this.readableOrder(ctx, parent.orderId);
    return order.currency;
  }
}
