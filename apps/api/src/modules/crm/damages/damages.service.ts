import { Injectable } from '@nestjs/common';
import type {
  AccessDifficulty,
  Damage,
  DamageExtraWork,
  DamagePriceSource,
  Material,
  Prisma,
} from '@prisma/client';
import {
  isKnownDamageType,
  isKnownPanel,
  resolveExtra,
  sizeClassForDimensions,
  SIZE_CLASS_CODES,
  type PriceRule,
} from '@pdr/shared';
import { AppError } from '@/common/errors/app.error';
import { PrismaService } from '@/infra/prisma/prisma.service';
import type { WorkspaceContext } from '@/modules/workspaces/workspace.types';
import { CrmParentAccess, type CrmParent } from '../access/crm-parent.access';
import { DamagesRepository } from '../repositories/damages.repository';
import { OrderPhotosRepository } from '../repositories/order-photos.repository';
import { PriceListRepository } from '../repositories/price-list.repository';

/** Столько повреждений на одной машине не бывает даже после града. */
const MAX_DAMAGES_PER_CARD = 60;

/** Арматурных работ на одной детали больше десятка не бывает. */
const MAX_EXTRA_WORKS_PER_DAMAGE = 12;

/**
 * Арматурная работа так, как её присылает карточка повреждения: позиция
 * справочника, своё название или и то и другое с поправленной ценой.
 */
export interface DamageExtraWorkInput {
  priceListItemId?: string | null;
  title?: string | null;
  quantity?: number | null;
  unitPriceMinor?: number | null;
}

export interface DamageInput {
  panelCode: string;
  damageType?: string | null;
  sizeClass?: string | null;
  widthMm?: number | null;
  heightMm?: number | null;
  quantity?: number;
  material?: Material | null;
  accessDifficulty?: AccessDifficulty | null;
  onEdge?: boolean;
  comment?: string | null;
  priceMinor?: number | null;
  priceSource?: DamagePriceSource | null;
  /** Арматурные работы этой детали: присылаются набором целиком. */
  extraWorks?: DamageExtraWorkInput[] | null;
}

export type DamageWithPhotoCount = Damage & {
  photoCount: number;
  extraWorks: DamageExtraWork[];
};

/**
 * Повреждения, отмеченные на схеме автомобиля.
 *
 * Схема — не картинка: каждое нажатие по детали создаёт запись, к которой
 * привязываются фотографии и оценка. Одна и та же деталь может быть повреждена
 * несколько раз, поэтому повторный выбор элемента добавляет ещё одну запись,
 * а не перетирает прежнюю: именно это отличает «вмятину на двери» от
 * «двух вмятин на двери, из которых в работу отдали одну».
 */
@Injectable()
export class DamagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly damages: DamagesRepository,
    private readonly photos: OrderPhotosRepository,
    private readonly priceList: PriceListRepository,
    private readonly access: CrmParentAccess,
  ) {}

  async listFor(ctx: WorkspaceContext, parent: CrmParent): Promise<DamageWithPhotoCount[]> {
    await this.access.assertReadable(ctx, parent);
    const items = await this.damages.listFor(ctx.workspaceId, parent);
    const ids = items.map((item) => item.id);
    const [counts, works] = await Promise.all([
      this.photos.countByDamage(ctx.workspaceId, ids),
      this.damages.listExtraWorks(ctx.workspaceId, ids),
    ]);
    return items.map((item) => ({
      ...item,
      photoCount: counts.get(item.id) ?? 0,
      extraWorks: works.filter((work) => work.damageId === item.id),
    }));
  }

  /** Одно повреждение со своими работами: карточка открывается по нему. */
  async getById(ctx: WorkspaceContext, damageId: string): Promise<DamageWithPhotoCount> {
    const damage = await this.damages.findById(ctx.workspaceId, damageId);
    if (!damage) throw AppError.notFound('Повреждение не найдено');
    await this.access.assertReadable(ctx, this.parentOf(damage));
    const [counts, works] = await Promise.all([
      this.photos.countByDamage(ctx.workspaceId, [damage.id]),
      this.damages.listExtraWorks(ctx.workspaceId, [damage.id]),
    ]);
    return { ...damage, photoCount: counts.get(damage.id) ?? 0, extraWorks: works };
  }

  async create(
    ctx: WorkspaceContext,
    parent: CrmParent,
    input: DamageInput,
  ): Promise<DamageWithPhotoCount> {
    await this.access.assertWritable(ctx, parent);

    const count = await this.damages.countFor(ctx.workspaceId, parent);
    if (count >= MAX_DAMAGES_PER_CARD) {
      throw AppError.validation('Слишком много отмеченных повреждений');
    }

    const data = this.normalizeInput(input);
    const position = await this.damages.nextPosition(ctx.workspaceId, parent);
    const works = await this.normalizeExtraWorks(ctx, input.extraWorks);

    const damage = await this.prisma.transaction(async (tx) => {
      const created = await this.damages.create(
        ctx.workspaceId,
        {
          ...('leadId' in parent ? { leadId: parent.leadId } : { orderId: parent.orderId }),
          ...data,
          position,
          createdById: ctx.userId,
        },
        tx,
      );
      if (works !== null) {
        await this.damages.replaceExtraWorks(ctx.workspaceId, created.id, works, tx);
      }
      return created;
    });

    return this.getById(ctx, damage.id);
  }

  async update(
    ctx: WorkspaceContext,
    damageId: string,
    input: Partial<DamageInput>,
  ): Promise<DamageWithPhotoCount> {
    const damage = await this.writable(ctx, damageId);
    const merged = this.normalizeInput({
      panelCode: input.panelCode ?? damage.panelCode,
      damageType: input.damageType !== undefined ? input.damageType : damage.damageType,
      sizeClass: input.sizeClass !== undefined ? input.sizeClass : damage.sizeClass,
      widthMm: input.widthMm !== undefined ? input.widthMm : damage.widthMm,
      heightMm: input.heightMm !== undefined ? input.heightMm : damage.heightMm,
      quantity: input.quantity ?? damage.quantity,
      material: input.material !== undefined ? input.material : damage.material,
      accessDifficulty:
        input.accessDifficulty !== undefined ? input.accessDifficulty : damage.accessDifficulty,
      onEdge: input.onEdge ?? damage.onEdge,
      comment: input.comment !== undefined ? input.comment : damage.comment,
      priceMinor:
        input.priceMinor !== undefined
          ? input.priceMinor
          : damage.priceMinor === null
            ? null
            : Number(damage.priceMinor),
      priceSource: input.priceSource !== undefined ? input.priceSource : damage.priceSource,
    });

    const works = await this.normalizeExtraWorks(ctx, input.extraWorks);

    await this.prisma.transaction(async (tx) => {
      await this.damages.update(ctx.workspaceId, damageId, merged, tx);
      if (works !== null) {
        await this.damages.replaceExtraWorks(ctx.workspaceId, damageId, works, tx);
      }
    });

    return this.getById(ctx, damageId);
  }

  /**
   * Цены арматурных работ считает сервер по справочнику мастерской.
   *
   * Тот же `resolveExtra`, что и в оценке: название и цена берутся из
   * справочника, ручная цена перебивает её. Интерфейс не должен уметь
   * подписать своей работой чужую цену, а второй расчёт здесь не нужен.
   *
   * Публично, потому что обращение создаётся вместе с отмеченными деталями
   * в одной транзакции, и работы там проходят ровно ту же проверку.
   */
  async normalizeExtraWorks(
    ctx: WorkspaceContext,
    input: DamageExtraWorkInput[] | null | undefined,
  ): Promise<
    Omit<Prisma.DamageExtraWorkUncheckedCreateInput, 'workspaceId' | 'damageId'>[] | null
  > {
    if (input === undefined) return null;
    const works = input ?? [];
    if (works.length === 0) return [];
    if (works.length > MAX_EXTRA_WORKS_PER_DAMAGE) {
      throw AppError.validation('Слишком много арматурных работ на одной детали');
    }

    const items = await this.priceList.list(ctx.workspaceId, true);
    const rules: PriceRule[] = items.map((item) => ({
      id: item.id,
      kind: item.kind,
      title: item.title,
      panelCode: item.panelCode,
      damageType: item.damageType,
      sizeClass: item.sizeClass,
      unitPriceMinor: Number(item.unitPriceMinor),
      unit: item.unit,
      isActive: item.isActive,
    }));

    return works.map((work, index) => {
      if (work.priceListItemId) {
        const rule = rules.find((r) => r.id === work.priceListItemId);
        if (!rule || rule.kind === 'damage') {
          throw AppError.validation('Арматурная работа не найдена в справочнике мастерской');
        }
      } else if (!work.title?.trim()) {
        throw AppError.validation('Назовите арматурную работу или выберите её из справочника');
      }

      const resolved = resolveExtra(
        {
          priceListItemId: work.priceListItemId ?? null,
          title: work.title ?? '',
          quantity: work.quantity ?? 1,
          unitPriceMinor: work.unitPriceMinor ?? null,
        },
        rules,
        index + 1,
      );

      return {
        priceListItemId: resolved.priceListItemId,
        title: resolved.title,
        quantity: resolved.quantity,
        unitPriceMinor: BigInt(resolved.unitPriceMinor),
        position: index + 1,
      };
    });
  }

  async remove(ctx: WorkspaceContext, damageId: string): Promise<void> {
    await this.writable(ctx, damageId);
    await this.damages.delete(ctx.workspaceId, damageId);
  }

  /** Цена повреждения после оценки. Источник запоминается: правка — всегда manual. */
  async setPrice(
    ctx: WorkspaceContext,
    damageId: string,
    priceMinor: number | null,
    source: DamagePriceSource,
  ): Promise<Damage> {
    await this.writable(ctx, damageId);
    return this.damages.update(ctx.workspaceId, damageId, {
      priceMinor: priceMinor === null ? null : BigInt(Math.max(0, Math.trunc(priceMinor))),
      priceSource: priceMinor === null ? null : source,
    });
  }

  private async writable(ctx: WorkspaceContext, damageId: string): Promise<Damage> {
    const damage = await this.damages.findById(ctx.workspaceId, damageId);
    if (!damage) throw AppError.notFound('Повреждение не найдено');
    await this.access.assertWritable(ctx, this.parentOf(damage));
    return damage;
  }

  private parentOf(damage: Damage): CrmParent {
    if (damage.leadId) return { leadId: damage.leadId };
    if (damage.orderId) return { orderId: damage.orderId };
    // База гарантирует ровно одного владельца, но проверка дешевле отладки.
    throw AppError.notFound('Повреждение не найдено');
  }

  /**
   * Приведение к согласованному виду.
   *
   * Размерный класс выводится из габаритов, если мастер их ввёл: 40×40 см —
   * это XL независимо от того, что выбрано в списке. Явно указанный класс
   * без габаритов остаётся как есть.
   *
   * Публично, потому что обращение создаётся вместе с отмеченными деталями
   * в одной транзакции, и проверка там должна быть ровно та же самая.
   */
  normalizeInput(input: DamageInput) {
    const panelCode = input.panelCode?.trim();
    if (!panelCode || !isKnownPanel(panelCode)) {
      throw AppError.validation('Неизвестный элемент кузова');
    }
    const damageType = input.damageType?.trim() || null;
    if (damageType && !isKnownDamageType(damageType)) {
      throw AppError.validation('Неизвестный тип повреждения');
    }

    const widthMm = this.positiveOrNull(input.widthMm);
    const heightMm = this.positiveOrNull(input.heightMm);
    const derived = sizeClassForDimensions(widthMm, heightMm);
    const sizeClass = derived ?? (input.sizeClass?.trim() || null);
    if (sizeClass && !SIZE_CLASS_CODES.includes(sizeClass)) {
      throw AppError.validation('Неизвестный размерный класс');
    }

    const quantity = Math.max(1, Math.trunc(input.quantity ?? 1));
    if (quantity > 500) throw AppError.validation('Слишком много вмятин в одной записи');

    return {
      panelCode,
      damageType,
      sizeClass,
      widthMm,
      heightMm,
      quantity,
      material: input.material ?? null,
      accessDifficulty: input.accessDifficulty ?? null,
      onEdge: input.onEdge ?? false,
      comment: input.comment ?? null,
      priceMinor:
        input.priceMinor === null || input.priceMinor === undefined
          ? null
          : BigInt(Math.max(0, Math.trunc(input.priceMinor))),
      priceSource:
        input.priceMinor === null || input.priceMinor === undefined
          ? null
          : (input.priceSource ?? 'manual'),
    };
  }

  private positiveOrNull(value: number | null | undefined): number | null {
    if (value === null || value === undefined) return null;
    const rounded = Math.trunc(value);
    if (!Number.isFinite(rounded) || rounded <= 0) return null;
    if (rounded > 5000) throw AppError.validation('Размер повреждения указан в миллиметрах');
    return rounded;
  }
}
