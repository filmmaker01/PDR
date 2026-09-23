import type { Damage, DamageExtraWork } from '@prisma/client';
import { describeDamageSize } from '@pdr/shared';
import type { OrderPhotoWithFile } from './repositories/order-photos.repository';

/**
 * Единая форма ответа для повреждений и фотографий.
 *
 * Обращение и заказ показывают одни и те же карточки одним и тем же
 * интерфейсом, поэтому и наружу они обязаны выглядеть одинаково: иначе
 * Mini App пришлось бы держать две ветки отрисовки одного и того же.
 */

export const PHOTO_CATEGORY_LABELS: Record<string, string> = {
  before: 'До',
  during: 'В процессе',
  after: 'После',
  document: 'Документы',
};

export function serializeDamage(
  damage: Damage & { photoCount?: number; extraWorks?: DamageExtraWork[] },
): Record<string, unknown> {
  const extraWorks = damage.extraWorks ?? [];
  const extrasMinor = extraWorks.reduce(
    (sum, work) => sum + work.quantity * Number(work.unitPriceMinor),
    0,
  );
  const priceMinor = damage.priceMinor === null ? null : Number(damage.priceMinor);
  // Фактический размер и тарифная зона — разные вещи и наружу идут раздельно:
  // интерфейс и документы показывают измеренное, а цену считает зона.
  const size = describeDamageSize(damage.widthMm, damage.heightMm, damage.sizeClass);

  return {
    id: damage.id,
    leadId: damage.leadId,
    orderId: damage.orderId,
    panelCode: damage.panelCode,
    damageType: damage.damageType,
    sizeClass: damage.sizeClass,
    widthMm: damage.widthMm,
    heightMm: damage.heightMm,
    /** Готовые подписи: «300 × 300 см» и «100×100+». */
    sizeText: size.actual,
    zoneLabel: size.zone,
    zoneCapped: size.capped,
    quantity: damage.quantity,
    material: damage.material,
    accessDifficulty: damage.accessDifficulty,
    onEdge: damage.onEdge,
    comment: damage.comment,
    priceMinor,
    priceSource: damage.priceSource,
    extraWorks: extraWorks.map((work) => ({
      id: work.id,
      priceListItemId: work.priceListItemId,
      title: work.title,
      quantity: work.quantity,
      unitPriceMinor: Number(work.unitPriceMinor),
      lineTotalMinor: work.quantity * Number(work.unitPriceMinor),
    })),
    extrasMinor,
    /** Итог по детали: ремонт плюс её арматурные работы. */
    totalMinor: (priceMinor ?? 0) + extrasMinor,
    position: damage.position,
    photoCount: damage.photoCount ?? 0,
    createdAt: damage.createdAt.toISOString(),
  };
}

export function serializePhoto(
  photo: OrderPhotoWithFile & { thumbUrl?: string | null },
): Record<string, unknown> {
  return {
    id: photo.id,
    fileId: photo.fileId,
    leadId: photo.leadId,
    orderId: photo.orderId,
    category: photo.category,
    categoryLabel: PHOTO_CATEGORY_LABELS[photo.category] ?? photo.category,
    caption: photo.caption,
    position: photo.position,
    damageId: photo.damageId,
    estimateItemId: photo.estimateItemId,
    /// Векторная разметка: интерфейс рисует её поверх оригинала.
    annotation: photo.annotation ?? null,
    hasMarkup: photo.annotation !== null && photo.annotation !== undefined,
    annotationFileId: photo.annotationFileId,
    annotatedAt: photo.annotatedAt?.toISOString() ?? null,
    status: photo.file.status,
    width: photo.file.width,
    height: photo.file.height,
    thumbUrl: photo.thumbUrl ?? null,
    createdAt: photo.createdAt.toISOString(),
  };
}
