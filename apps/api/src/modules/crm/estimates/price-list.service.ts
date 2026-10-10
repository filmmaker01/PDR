import { Injectable } from '@nestjs/common';
import type { EstimateItemKind, PriceListItem, PriceUnit } from '@prisma/client';
import { sizeTierBoundsLabel } from '@pdr/shared';
import { AppError } from '@/common/errors/app.error';
import type { WorkspaceContext } from '@/modules/workspaces/workspace.types';
import { PriceListRepository } from '../repositories/price-list.repository';

export interface PriceListItemInput {
  kind?: EstimateItemKind;
  title?: string;
  panelCode?: string | null;
  damageType?: string | null;
  sizeClass?: string | null;
  unitPriceMinor: number;
  unit?: PriceUnit;
  isActive?: boolean;
  /** Строка размерной сетки «до ширина × высота». */
  sizeTier?: boolean;
  maxWidthMm?: number | null;
  maxHeightMm?: number | null;
}

/**
 * Название строки размерной сетки собирается из границ: так подпись в
 * прайсе, в оценке и в документах никогда не расходится с самими границами.
 */
function tierTitle(maxWidthMm: number | null, maxHeightMm: number | null): string {
  const bounds = sizeTierBoundsLabel({ id: '', maxWidthMm, maxHeightMm });
  return bounds ? `Размер до ${bounds} см` : 'Размер крупнее остальных';
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
    if (input.sizeTier) {
      const bounds = this.tierBounds(input.maxWidthMm ?? null, input.maxHeightMm ?? null);
      return this.priceList.create(ctx.workspaceId, {
        kind: 'damage',
        title: tierTitle(bounds.maxWidthMm, bounds.maxHeightMm),
        sizeTier: true,
        ...bounds,
        unitPriceMinor: BigInt(input.unitPriceMinor),
        unit: input.unit ?? 'per_item',
        isActive: input.isActive ?? true,
        position,
      });
    }
    if (input.maxWidthMm || input.maxHeightMm) {
      throw AppError.validation('Границы размера задаются только у строки размерной сетки');
    }
    const title = input.title?.trim();
    if (!title) throw AppError.validation('Введите название позиции');
    return this.priceList.create(ctx.workspaceId, {
      kind: input.kind ?? 'damage',
      title,
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
    const existing = await this.priceList.findById(ctx.workspaceId, itemId);
    if (!existing) throw AppError.notFound('Позиция прайса не найдена');

    if (input.sizeTier !== undefined && input.sizeTier !== existing.sizeTier) {
      throw AppError.validation('Строку размерной сетки нельзя превратить в обычную позицию');
    }

    if (existing.sizeTier) {
      // У строки сетки меняются только границы, цена и активность.
      const bounds = this.tierBounds(
        input.maxWidthMm !== undefined ? input.maxWidthMm : existing.maxWidthMm,
        input.maxHeightMm !== undefined ? input.maxHeightMm : existing.maxHeightMm,
      );
      return this.priceList.update(ctx.workspaceId, itemId, {
        ...bounds,
        title: tierTitle(bounds.maxWidthMm, bounds.maxHeightMm),
        ...(input.unitPriceMinor !== undefined
          ? { unitPriceMinor: BigInt(input.unitPriceMinor) }
          : {}),
        ...(input.unit !== undefined ? { unit: input.unit } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      });
    }
    if (input.maxWidthMm || input.maxHeightMm) {
      throw AppError.validation('Границы размера задаются только у строки размерной сетки');
    }
    if (input.title !== undefined && !input.title.trim()) {
      throw AppError.validation('Введите название позиции');
    }

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

  /** Обе границы или ни одной: «до 40 × ?» не описывает никакой размер. */
  private tierBounds(
    maxWidthMm: number | null,
    maxHeightMm: number | null,
  ): { maxWidthMm: number | null; maxHeightMm: number | null } {
    const width = maxWidthMm && maxWidthMm > 0 ? maxWidthMm : null;
    const height = maxHeightMm && maxHeightMm > 0 ? maxHeightMm : null;
    if ((width === null) !== (height === null)) {
      throw AppError.validation('Укажите обе границы диапазона — ширину и высоту — или ни одной');
    }
    return { maxWidthMm: width, maxHeightMm: height };
  }

  async reorder(ctx: WorkspaceContext, ids: string[]): Promise<void> {
    const items = await this.priceList.findManyByIds(ctx.workspaceId, ids);
    if (items.length !== ids.length) throw AppError.validation('Позиция прайса не найдена');
    await this.priceList.reorder(ctx.workspaceId, ids);
  }
}
