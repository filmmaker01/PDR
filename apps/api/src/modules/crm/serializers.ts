import type { Damage } from '@prisma/client';
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

export function serializeDamage(damage: Damage & { photoCount?: number }): Record<string, unknown> {
  return {
    id: damage.id,
    leadId: damage.leadId,
    orderId: damage.orderId,
    panelCode: damage.panelCode,
    damageType: damage.damageType,
    sizeClass: damage.sizeClass,
    widthMm: damage.widthMm,
    heightMm: damage.heightMm,
    quantity: damage.quantity,
    material: damage.material,
    accessDifficulty: damage.accessDifficulty,
    onEdge: damage.onEdge,
    comment: damage.comment,
    priceMinor: damage.priceMinor === null ? null : Number(damage.priceMinor),
    priceSource: damage.priceSource,
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
