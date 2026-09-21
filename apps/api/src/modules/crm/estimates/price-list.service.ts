import { Injectable } from '@nestjs/common';
import type { EstimateItemKind, PriceListItem, PriceUnit } from '@prisma/client';
import { AppError } from '@/common/errors/app.error';
import type { WorkspaceContext } from '@/modules/workspaces/workspace.types';
import { PriceListRepository } from '../repositories/price-list.repository';

export interface PriceListItemInput {
  kind?: EstimateItemKind;
  title: string;
  panelCode?: string | null;
  damageType?: string | null;
  sizeClass?: string | null;
  unitPriceMinor: number;
  unit?: PriceUnit;
  isActive?: boolean;
}

/** Прайс мастерской: справочник для быстрого набора сметы. */
@Injectable()
export class PriceListService {
  constructor(private readonly priceList: PriceListRepository) {}

  async list(
    ctx: WorkspaceContext,
    includeInactive = false,
    kind?: EstimateItemKind,
  ): Promise<PriceListItem[]> {
    return this.priceList.list(ctx.workspaceId, includeInactive, kind);
  }

  async create(ctx: WorkspaceContext, input: PriceListItemInput): Promise<PriceListItem> {
    const position = await this.priceList.nextPosition(ctx.workspaceId);
    return this.priceList.create(ctx.workspaceId, {
      kind: input.kind ?? 'damage',
      title: input.title.trim(),
      panelCode: input.panelCode ?? null,
      damageType: input.damageType ?? null,
      sizeClass: input.sizeClass ?? null,
      unitPriceMinor: BigInt(input.unitPriceMinor),
      unit: input.unit ?? 'per_item',
      isActive: input.isActive ?? true,
      position,
    });
  }

  async update(
    ctx: WorkspaceContext,
    itemId: string,
    input: Partial<PriceListItemInput>,
  ): Promise<PriceListItem> {
    return this.priceList.update(ctx.workspaceId, itemId, {
      ...(input.kind !== undefined ? { kind: input.kind } : {}),
      ...(input.title !== undefined ? { title: input.title.trim() } : {}),
      ...(input.panelCode !== undefined ? { panelCode: input.panelCode } : {}),
      ...(input.damageType !== undefined ? { damageType: input.damageType } : {}),
      ...(input.sizeClass !== undefined ? { sizeClass: input.sizeClass } : {}),
      ...(input.unitPriceMinor !== undefined
        ? { unitPriceMinor: BigInt(input.unitPriceMinor) }
        : {}),
      ...(input.unit !== undefined ? { unit: input.unit } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    });
  }

  /**
   * Удаление позиции, уже попавшей в сметы, запрещено: цена в смете
   * скопирована, но ссылка на источник нужна для истории. Такая позиция
   * деактивируется и перестаёт предлагаться при наборе.
   */
  async remove(ctx: WorkspaceContext, itemId: string): Promise<{ deleted: boolean }> {
    const item = await this.priceList.findById(ctx.workspaceId, itemId);
    if (!item) throw AppError.notFound('Позиция прайса не найдена');

    const usage = await this.priceList.usageCount(ctx.workspaceId, itemId);
    if (usage > 0) {
      await this.priceList.update(ctx.workspaceId, itemId, { isActive: false });
      return { deleted: false };
    }
    await this.priceList.delete(ctx.workspaceId, itemId);
    return { deleted: true };
  }

  async reorder(ctx: WorkspaceContext, ids: string[]): Promise<void> {
    const items = await this.priceList.findManyByIds(ctx.workspaceId, ids);
    if (items.length !== ids.length) throw AppError.validation('Позиция прайса не найдена');
    await this.priceList.reorder(ctx.workspaceId, ids);
  }
}
