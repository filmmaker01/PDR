import { Injectable } from '@nestjs/common';
import type { Order, OrderPhoto, PhotoCategory, User } from '@prisma/client';
import { ownsRecord } from '@pdr/shared';
import { AppError } from '@/common/errors/app.error';
import { FilesService } from '@/modules/files/files.service';
import type { WorkspaceContext } from '@/modules/workspaces/workspace.types';
import { OrdersRepository } from '../repositories/orders.repository';
import { EstimatesRepository } from '../repositories/estimates.repository';
import {
  OrderPhotosRepository,
  type OrderPhotoWithFile,
} from '../repositories/order-photos.repository';

/** Больше тысячи снимков на заказ — это не работа, а ошибка загрузки. */
const MAX_PHOTOS_PER_ORDER = 1000;

export interface AttachPhotoInput {
  fileId: string;
  category?: PhotoCategory;
  estimateItemId?: string | null;
  caption?: string | null;
}

@Injectable()
export class OrderPhotosService {
  constructor(
    private readonly photos: OrderPhotosRepository,
    private readonly orders: OrdersRepository,
    private readonly estimates: EstimatesRepository,
    private readonly files: FilesService,
  ) {}

  async listForOrder(
    ctx: WorkspaceContext,
    orderId: string,
    auth: { user: User; platformRoles: string[] },
  ): Promise<{
    items: (OrderPhotoWithFile & { thumbUrl: string | null })[];
  }> {
    await this.orderFor(ctx, orderId);
    const items = await this.photos.listForOrder(ctx.workspaceId, orderId);
    if (items.length === 0) return { items: [] };

    // Ссылки пачкой: список фотографий не должен делать запрос на каждую.
    const urls = await this.files.downloadUrls(
      items.map((photo) => photo.fileId),
      auth.user,
      auth.platformRoles,
      'thumb',
    );
    return { items: items.map((photo) => ({ ...photo, thumbUrl: urls[photo.fileId] ?? null })) };
  }

  /** Привязка уже загруженного файла к заказу. */
  async attach(
    ctx: WorkspaceContext,
    orderId: string,
    input: AttachPhotoInput,
  ): Promise<OrderPhoto> {
    const order = await this.orderFor(ctx, orderId);
    this.assertCanWrite(ctx, order);

    const count = await this.photos.countForOrder(ctx.workspaceId, orderId);
    if (count >= MAX_PHOTOS_PER_ORDER) {
      throw AppError.validation('В заказе слишком много фотографий');
    }

    const file = await this.files.getById(input.fileId);
    if (file.scope !== 'order_photo') {
      throw AppError.validation('Файл загружен не как фотография заказа');
    }
    // Файл и заказ обязаны быть из одной мастерской: иначе снимок чужого
    // клиента попал бы в чужую карточку.
    if (file.workspaceId !== ctx.workspaceId) throw AppError.notFound('Файл не найден');
    if (file.ownerUserId !== ctx.userId && !ctx.permissions.has('orders.write_all')) {
      throw AppError.notFound('Файл не найден');
    }

    if (input.estimateItemId) {
      await this.assertEstimateItem(ctx, orderId, input.estimateItemId);
    }

    const category = input.category ?? 'before';
    const position = await this.photos.nextPosition(ctx.workspaceId, orderId, category);

    const existing = await this.photos.findByFile(ctx.workspaceId, orderId, input.fileId);
    if (existing) {
      // Повторная привязка того же файла — это двойной тап, а не новая фотография.
      throw new AppError('already_exists', 'Эта фотография уже добавлена в заказ', {
        photoId: existing.id,
      });
    }

    return this.photos.create(ctx.workspaceId, {
      orderId,
      fileId: input.fileId,
      category,
      estimateItemId: input.estimateItemId ?? null,
      caption: input.caption ?? null,
      position,
      createdById: ctx.userId,
    });
  }

  async update(
    ctx: WorkspaceContext,
    photoId: string,
    input: {
      category?: PhotoCategory;
      caption?: string | null;
      position?: number;
      estimateItemId?: string | null;
    },
  ): Promise<OrderPhoto> {
    const photo = await this.photos.findById(ctx.workspaceId, photoId);
    if (!photo) throw AppError.notFound('Фотография не найдена');
    const order = await this.orderFor(ctx, photo.orderId);
    this.assertCanWrite(ctx, order);

    if (input.estimateItemId) {
      await this.assertEstimateItem(ctx, photo.orderId, input.estimateItemId);
    }

    return this.photos.update(ctx.workspaceId, photoId, {
      ...(input.category !== undefined ? { category: input.category } : {}),
      ...(input.caption !== undefined ? { caption: input.caption } : {}),
      ...(input.position !== undefined ? { position: input.position } : {}),
      ...(input.estimateItemId !== undefined ? { estimateItemId: input.estimateItemId } : {}),
    });
  }

  /** Удаление снимка из заказа удаляет и сам файл: он больше нигде не нужен. */
  async remove(
    ctx: WorkspaceContext,
    photoId: string,
    auth: { user: User; platformRoles: string[] },
  ): Promise<void> {
    const photo = await this.photos.findById(ctx.workspaceId, photoId);
    if (!photo) throw AppError.notFound('Фотография не найдена');
    const order = await this.orderFor(ctx, photo.orderId);
    this.assertCanWrite(ctx, order);

    await this.photos.delete(ctx.workspaceId, photoId);
    await this.files.softDelete(photo.fileId, auth.user, auth.platformRoles);
  }

  async downloadUrl(
    ctx: WorkspaceContext,
    photoId: string,
    auth: { user: User; platformRoles: string[] },
  ): Promise<{ url: string; expiresAt: string }> {
    const photo = await this.photos.findById(ctx.workspaceId, photoId);
    if (!photo) throw AppError.notFound('Фотография не найдена');
    await this.orderFor(ctx, photo.orderId);
    return this.files.downloadUrl(photo.fileId, auth.user, auth.platformRoles, 'original');
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

  private async orderFor(ctx: WorkspaceContext, orderId: string): Promise<Order> {
    const order = await this.orders.findById(ctx.workspaceId, orderId);
    if (!order) throw AppError.notFound('Заказ не найден');
    if (!ctx.permissions.has('orders.read_all')) {
      if (!ownsRecord({ memberId: ctx.member.id, userId: ctx.userId }, order)) {
        throw AppError.notFound('Заказ не найден');
      }
    }
    return order;
  }

  private assertCanWrite(ctx: WorkspaceContext, order: Order): void {
    if (ctx.permissions.has('orders.write_all')) return;
    if (!ownsRecord({ memberId: ctx.member.id, userId: ctx.userId }, order)) {
      throw AppError.notFound('Заказ не найден');
    }
  }
}
