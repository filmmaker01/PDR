import { Injectable } from '@nestjs/common';
import { Prisma, type OrderPhoto, type PhotoCategory, type User } from '@prisma/client';
import { AppError } from '@/common/errors/app.error';
import { FilesService } from '@/modules/files/files.service';
import type { WorkspaceContext } from '@/modules/workspaces/workspace.types';
import { CrmParentAccess, isLeadParent } from '../access/crm-parent.access';
import { EstimatesRepository } from '../repositories/estimates.repository';
import { DamagesRepository } from '../repositories/damages.repository';
import {
  OrderPhotosRepository,
  type OrderPhotoWithFile,
  type PhotoParent,
} from '../repositories/order-photos.repository';

/** Больше тысячи снимков на заказ — это не работа, а ошибка загрузки. */
const MAX_PHOTOS_PER_ORDER = 1000;
/** Обращение — это ещё не заказ: пачка снимков от клиента, а не съёмка ремонта. */
const MAX_PHOTOS_PER_LEAD = 100;

/** Снимок из формы новой записи: повреждение указано номером в массиве damages. */
export interface DraftPhotoInput {
  fileId: string;
  category?: PhotoCategory;
  caption?: string | null;
  damageIndex?: number | null;
  annotation?: unknown;
  annotationFileId?: string | null;
}

export interface DraftPhotosResult {
  attached: number;
  failed: { fileId: string; message: string }[];
  markupFailed: number;
}

export interface AttachPhotoInput {
  fileId: string;
  category?: PhotoCategory;
  estimateItemId?: string | null;
  damageId?: string | null;
  caption?: string | null;
}

/**
 * Разметка повреждения поверх снимка.
 *
 * Хранится векторно, а не картинкой: так её можно открыть и поправить, а
 * оригинал остаётся нетронутым. Сведённая картинка — производная, нужна для
 * печати и выгрузки; без неё разметка всё равно не теряется.
 */
export interface PhotoMarkupInput {
  annotation: unknown | null;
  annotationFileId?: string | null;
}

@Injectable()
export class OrderPhotosService {
  constructor(
    private readonly photos: OrderPhotosRepository,
    private readonly access: CrmParentAccess,
    private readonly estimates: EstimatesRepository,
    private readonly damages: DamagesRepository,
    private readonly files: FilesService,
  ) {}

  // ── Чтение ────────────────────────────────────────────────────────────────

  async listFor(
    ctx: WorkspaceContext,
    parent: PhotoParent,
    auth: { user: User; platformRoles: string[] },
  ): Promise<{ items: (OrderPhotoWithFile & { thumbUrl: string | null })[] }> {
    await this.access.assertReadable(ctx, parent);
    const items = await this.photos.listFor(ctx.workspaceId, parent);
    if (items.length === 0) return { items: [] };

    // Ссылки пачкой: список фотографий не должен делать запрос на каждую.
    // Сведённая разметка — отдельный файл, её ссылка нужна там же.
    const fileIds = [
      ...new Set(
        items.flatMap((photo) =>
          photo.annotationFileId ? [photo.fileId, photo.annotationFileId] : [photo.fileId],
        ),
      ),
    ];
    const urls = await this.files.downloadUrls(fileIds, auth.user, auth.platformRoles, 'thumb');
    return { items: items.map((photo) => ({ ...photo, thumbUrl: urls[photo.fileId] ?? null })) };
  }

  async listForOrder(
    ctx: WorkspaceContext,
    orderId: string,
    auth: { user: User; platformRoles: string[] },
  ) {
    return this.listFor(ctx, { orderId }, auth);
  }

  // ── Привязка и правка ─────────────────────────────────────────────────────

  /** Привязка уже загруженного файла к заказу или обращению. */
  async attach(
    ctx: WorkspaceContext,
    parent: PhotoParent,
    input: AttachPhotoInput,
  ): Promise<OrderPhoto> {
    await this.access.assertWritable(ctx, parent);

    const count = await this.photos.countFor(ctx.workspaceId, parent);
    const limit = isLeadParent(parent) ? MAX_PHOTOS_PER_LEAD : MAX_PHOTOS_PER_ORDER;
    if (count >= limit) {
      throw AppError.validation(
        isLeadParent(parent)
          ? 'В обращении слишком много фотографий'
          : 'В заказе слишком много фотографий',
      );
    }

    await this.assertOwnFile(ctx, input.fileId);

    if (input.estimateItemId) {
      if (isLeadParent(parent)) {
        throw AppError.validation('У обращения ещё нет сметы');
      }
      await this.assertEstimateItem(ctx, parent.orderId, input.estimateItemId);
    }
    if (input.damageId) await this.assertDamage(ctx, parent, input.damageId);

    const category = input.category ?? 'before';
    const position = await this.photos.nextPosition(ctx.workspaceId, parent, category);

    const existing = await this.photos.findByFile(ctx.workspaceId, parent, input.fileId);
    if (existing) {
      // Повторная привязка того же файла — это двойной тап, а не новая фотография.
      throw new AppError('already_exists', 'Эта фотография уже добавлена', {
        photoId: existing.id,
      });
    }

    return this.photos.create(ctx.workspaceId, {
      ...(isLeadParent(parent) ? { leadId: parent.leadId } : { orderId: parent.orderId }),
      fileId: input.fileId,
      category,
      estimateItemId: input.estimateItemId ?? null,
      damageId: input.damageId ?? null,
      caption: input.caption ?? null,
      position,
      createdById: ctx.userId,
    });
  }

  /**
   * Снимки из формы новой записи: привязка, связь с повреждением и разметка.
   *
   * Запись уже создана, и терять её из-за одной неудачной фотографии нельзя:
   * снимок, который не прикрепился, возвращается в списке, мастер добавит его
   * из карточки. Разметка сохраняется тем же путём, что во вкладке «Фото».
   */
  async attachDraftPhotos(
    ctx: WorkspaceContext,
    parent: PhotoParent,
    photos: DraftPhotoInput[],
    damageIds: readonly string[],
    auth: { user: User; platformRoles: string[] },
  ): Promise<DraftPhotosResult> {
    const result: DraftPhotosResult = { attached: 0, failed: [], markupFailed: 0 };
    for (const photo of photos) {
      const damageId =
        photo.damageIndex === null || photo.damageIndex === undefined
          ? null
          : (damageIds[photo.damageIndex] ?? null);
      let attached: OrderPhoto;
      try {
        attached = await this.attach(ctx, parent, {
          fileId: photo.fileId,
          category: photo.category,
          caption: photo.caption ?? null,
          damageId,
        });
        result.attached += 1;
      } catch (error) {
        result.failed.push({
          fileId: photo.fileId,
          message: error instanceof AppError ? error.message : 'Не удалось прикрепить фотографию',
        });
        continue;
      }
      if (photo.annotation) {
        await this.saveMarkup(
          ctx,
          attached.id,
          { annotation: photo.annotation, annotationFileId: photo.annotationFileId ?? null },
          auth,
        ).catch(() => {
          result.markupFailed += 1;
        });
      }
    }
    return result;
  }

  async update(
    ctx: WorkspaceContext,
    photoId: string,
    input: {
      category?: PhotoCategory;
      caption?: string | null;
      position?: number;
      estimateItemId?: string | null;
      damageId?: string | null;
    },
  ): Promise<OrderPhoto> {
    const photo = await this.photoFor(ctx, photoId, 'write');
    const parent = this.parentOf(photo);

    if (input.estimateItemId) {
      if (isLeadParent(parent)) throw AppError.validation('У обращения ещё нет сметы');
      await this.assertEstimateItem(ctx, parent.orderId, input.estimateItemId);
    }
    if (input.damageId) await this.assertDamage(ctx, parent, input.damageId);

    return this.photos.update(ctx.workspaceId, photoId, {
      ...(input.category !== undefined ? { category: input.category } : {}),
      ...(input.caption !== undefined ? { caption: input.caption } : {}),
      ...(input.position !== undefined ? { position: input.position } : {}),
      ...(input.estimateItemId !== undefined ? { estimateItemId: input.estimateItemId } : {}),
      ...(input.damageId !== undefined ? { damageId: input.damageId } : {}),
    });
  }

  /**
   * Сохранение разметки повреждения на снимке.
   *
   * Оригинал не трогается: разметка приходит отдельно, а сведённая картинка
   * загружается как самостоятельный файл. Именно поэтому в спорной ситуации
   * видно и исходное состояние детали, и ровно ту вмятину, которую
   * согласовали в работу.
   */
  async saveMarkup(
    ctx: WorkspaceContext,
    photoId: string,
    input: PhotoMarkupInput,
    auth: { user: User; platformRoles: string[] },
  ): Promise<OrderPhoto> {
    const photo = await this.photoFor(ctx, photoId, 'write');

    if (input.annotationFileId) {
      if (input.annotationFileId === photo.fileId) {
        throw AppError.validation('Разметка не может подменять оригинал снимка');
      }
      await this.assertOwnFile(ctx, input.annotationFileId);
    }

    const cleared = input.annotation === null;
    const previousAnnotationFileId = photo.annotationFileId;

    const updated = await this.photos.update(ctx.workspaceId, photoId, {
      annotation: cleared ? Prisma.DbNull : (input.annotation as Prisma.InputJsonValue),
      annotationFileId: cleared
        ? null
        : (input.annotationFileId ?? previousAnnotationFileId ?? null),
      annotatedAt: cleared ? null : new Date(),
    });

    // Прежняя сведённая картинка больше не нужна: она описывала старую разметку.
    const replaced =
      cleared || (input.annotationFileId && input.annotationFileId !== previousAnnotationFileId);
    if (previousAnnotationFileId && replaced) {
      await this.files.softDelete(previousAnnotationFileId, auth.user, auth.platformRoles);
    }

    return updated;
  }

  /** Удаление снимка удаляет и файлы: они больше нигде не нужны. */
  async remove(
    ctx: WorkspaceContext,
    photoId: string,
    auth: { user: User; platformRoles: string[] },
  ): Promise<void> {
    const photo = await this.photoFor(ctx, photoId, 'write');

    await this.photos.delete(ctx.workspaceId, photoId);
    await this.files.softDelete(photo.fileId, auth.user, auth.platformRoles);
    if (photo.annotationFileId) {
      await this.files.softDelete(photo.annotationFileId, auth.user, auth.platformRoles);
    }
  }

  async downloadUrl(
    ctx: WorkspaceContext,
    photoId: string,
    auth: { user: User; platformRoles: string[] },
    variant: 'original' | 'annotation' = 'original',
  ): Promise<{ url: string; expiresAt: string }> {
    const photo = await this.photoFor(ctx, photoId, 'read');
    if (variant === 'annotation') {
      if (!photo.annotationFileId) throw AppError.notFound('Разметка не сохранена');
      return this.files.downloadUrl(
        photo.annotationFileId,
        auth.user,
        auth.platformRoles,
        'original',
      );
    }
    return this.files.downloadUrl(photo.fileId, auth.user, auth.platformRoles, 'original');
  }

  /** Подписанные ссылки на оригиналы — нужны AI-оценке, чтобы отдать их провайдеру. */
  async originalUrls(
    photoIds: readonly string[],
    ctx: WorkspaceContext,
    auth: { user: User; platformRoles: string[] },
  ): Promise<{ photoId: string; fileId: string; mimeType: string; url: string }[]> {
    const result: { photoId: string; fileId: string; mimeType: string; url: string }[] = [];
    for (const photoId of photoIds) {
      const photo = await this.photoFor(ctx, photoId, 'read');
      const { url } = await this.files.downloadUrl(
        photo.fileId,
        auth.user,
        auth.platformRoles,
        'original',
      );
      result.push({ photoId, fileId: photo.fileId, mimeType: photo.file.mimeType, url });
    }
    return result;
  }

  // ── Вспомогательное ───────────────────────────────────────────────────────

  private parentOf(photo: OrderPhoto): PhotoParent {
    if (photo.leadId) return { leadId: photo.leadId };
    if (photo.orderId) return { orderId: photo.orderId };
    // База гарантирует ровно одного владельца, но проверка дешевле отладки.
    throw AppError.notFound('Фотография не найдена');
  }

  private async photoFor(
    ctx: WorkspaceContext,
    photoId: string,
    intent: 'read' | 'write',
  ): Promise<OrderPhotoWithFile> {
    const photo = await this.photos.findById(ctx.workspaceId, photoId);
    if (!photo) throw AppError.notFound('Фотография не найдена');
    const parent = this.parentOf(photo);
    if (intent === 'write') await this.access.assertWritable(ctx, parent);
    else await this.access.assertReadable(ctx, parent);
    return photo;
  }

  private async assertOwnFile(ctx: WorkspaceContext, fileId: string): Promise<void> {
    const file = await this.files.getById(fileId);
    if (file.scope !== 'order_photo') {
      throw AppError.validation('Файл загружен не как фотография мастерской');
    }
    // Файл и карточка обязаны быть из одной мастерской: иначе снимок чужого
    // клиента попал бы в чужую карточку.
    if (file.workspaceId !== ctx.workspaceId) throw AppError.notFound('Файл не найден');
    if (file.ownerUserId !== ctx.userId && !ctx.permissions.has('orders.write_all')) {
      throw AppError.notFound('Файл не найден');
    }
  }

  private async assertEstimateItem(
    ctx: WorkspaceContext,
    orderId: string,
    estimateItemId: string,
  ): Promise<void> {
    const estimates = await this.estimates.listForOrder(ctx.workspaceId, orderId);
    const found = estimates.some((estimate) =>
      estimate.items.some((item) => item.id === estimateItemId),
    );
    if (!found) throw AppError.validation('Позиция сметы не найдена в этом заказе');
  }

  /** Повреждение и снимок обязаны принадлежать одной и той же карточке. */
  private async assertDamage(
    ctx: WorkspaceContext,
    parent: PhotoParent,
    damageId: string,
  ): Promise<void> {
    const damage = await this.damages.findById(ctx.workspaceId, damageId);
    if (!damage) throw AppError.validation('Повреждение не найдено');
    const sameParent = isLeadParent(parent)
      ? damage.leadId === parent.leadId
      : damage.orderId === parent.orderId;
    if (!sameParent) throw AppError.validation('Повреждение относится к другой карточке');
  }
}
