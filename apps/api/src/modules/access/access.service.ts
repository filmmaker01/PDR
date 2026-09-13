import { Injectable, Logger } from '@nestjs/common';
import type { AccessGrant, GrantSource, Prisma, Product } from '@prisma/client';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { AppError } from '@/common/errors/app.error';

export interface GrantQuery {
  product: Product;
  userId?: string | null;
  workspaceId?: string | null;
  courseId?: string | null;
  at?: Date;
}

export interface ActiveAccess {
  granted: boolean;
  grant: AccessGrant | null;
  validUntil: Date | null;
}

export interface CreateGrantInput {
  product: Product;
  userId?: string | null;
  workspaceId?: string | null;
  courseId?: string | null;
  validFrom?: Date;
  validUntil?: Date | null;
  source?: GrantSource;
  externalRef?: string | null;
  reason?: string | null;
  grantedById: string;
}

/**
 * Единственная точка проверки продуктовых доступов.
 * Курс, CRM и клуб независимы: отзыв одного не влияет на остальные.
 */
@Injectable()
export class AccessService {
  private readonly logger = new Logger(AccessService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Условие «доступ действует прямо сейчас». */
  private activeWhere(at: Date): Prisma.AccessGrantWhereInput {
    return {
      status: 'active',
      validFrom: { lte: at },
      OR: [{ validUntil: null }, { validUntil: { gt: at } }],
    };
  }

  async check(query: GrantQuery): Promise<ActiveAccess> {
    const at = query.at ?? new Date();
    const grant = await this.prisma.accessGrant.findFirst({
      where: {
        product: query.product,
        ...(query.userId ? { userId: query.userId } : {}),
        ...(query.workspaceId ? { workspaceId: query.workspaceId } : {}),
        ...(query.courseId ? { courseId: query.courseId } : {}),
        ...this.activeWhere(at),
      },
      // Бессрочный доступ важнее срочного, затем — самый длинный срок.
      orderBy: [{ validUntil: { sort: 'desc', nulls: 'first' } }],
    });
    return { granted: grant !== null, grant, validUntil: grant?.validUntil ?? null };
  }

  async has(query: GrantQuery): Promise<boolean> {
    return (await this.check(query)).granted;
  }

  /** Бросает ошибку с понятным текстом, если доступа нет. */
  async assert(query: GrantQuery, message: string): Promise<AccessGrant> {
    const result = await this.check(query);
    if (!result.grant) throw new AppError('product_access_required', message);
    return result.grant;
  }

  /** Все действующие доступы пользователя и его мастерских — для GET /me. */
  async listActiveForUser(userId: string, workspaceIds: string[]): Promise<AccessGrant[]> {
    const at = new Date();
    return this.prisma.accessGrant.findMany({
      where: {
        AND: [
          this.activeWhere(at),
          {
            OR: [
              { userId },
              ...(workspaceIds.length ? [{ workspaceId: { in: workspaceIds } }] : []),
            ],
          },
        ],
      },
    });
  }

  async listAll(filter: {
    product?: Product;
    status?: AccessGrant['status'];
    userId?: string;
    workspaceId?: string;
    expiringBefore?: Date;
    limit: number;
    cursor?: string;
  }): Promise<{ items: AccessGrant[]; nextCursor: string | null }> {
    const items = await this.prisma.accessGrant.findMany({
      where: {
        ...(filter.product ? { product: filter.product } : {}),
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.userId ? { userId: filter.userId } : {}),
        ...(filter.workspaceId ? { workspaceId: filter.workspaceId } : {}),
        ...(filter.expiringBefore
          ? { status: 'active', validUntil: { not: null, lte: filter.expiringBefore } }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: filter.limit + 1,
      ...(filter.cursor ? { cursor: { id: filter.cursor }, skip: 1 } : {}),
    });
    const hasMore = items.length > filter.limit;
    const page = hasMore ? items.slice(0, filter.limit) : items;
    return { items: page, nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null };
  }

  async create(input: CreateGrantInput): Promise<AccessGrant> {
    this.validateSubject(input);
    return this.prisma.accessGrant.create({
      data: {
        product: input.product,
        subjectType: input.product === 'crm' ? 'workspace' : 'user',
        userId: input.product === 'crm' ? null : (input.userId ?? null),
        workspaceId: input.product === 'crm' ? (input.workspaceId ?? null) : null,
        courseId: input.courseId ?? null,
        validFrom: input.validFrom ?? new Date(),
        validUntil: input.validUntil ?? null,
        source: input.source ?? 'manual',
        externalRef: input.externalRef ?? null,
        reason: input.reason ?? null,
        grantedById: input.grantedById,
        status: 'active',
      },
    });
  }

  /**
   * Продление: если действующий доступ есть — сдвигается его срок,
   * иначе создаётся новый. Так не появляется набор пересекающихся грантов.
   */
  async extend(grantId: string, validUntil: Date | null, reason: string): Promise<AccessGrant> {
    const grant = await this.getById(grantId);
    if (validUntil && validUntil <= grant.validFrom) {
      throw AppError.validation('Дата окончания должна быть позже даты начала');
    }
    return this.prisma.accessGrant.update({
      where: { id: grantId },
      data: {
        validUntil,
        status: 'active',
        revokedAt: null,
        revokedById: null,
        reason,
      },
    });
  }

  async revoke(grantId: string, revokedById: string, reason: string): Promise<AccessGrant> {
    await this.getById(grantId);
    return this.prisma.accessGrant.update({
      where: { id: grantId },
      data: { status: 'revoked', revokedAt: new Date(), revokedById, reason },
    });
  }

  async suspend(grantId: string, reason: string): Promise<AccessGrant> {
    await this.getById(grantId);
    return this.prisma.accessGrant.update({
      where: { id: grantId },
      data: { status: 'suspended', reason },
    });
  }

  async resume(grantId: string, reason: string): Promise<AccessGrant> {
    const grant = await this.getById(grantId);
    if (grant.validUntil && grant.validUntil <= new Date()) {
      throw AppError.conflict('Срок доступа истёк, продлите его вместо возобновления');
    }
    return this.prisma.accessGrant.update({
      where: { id: grantId },
      data: { status: 'active', reason },
    });
  }

  async getById(grantId: string): Promise<AccessGrant> {
    const grant = await this.prisma.accessGrant.findUnique({ where: { id: grantId } });
    if (!grant) throw AppError.notFound('Доступ не найден');
    return grant;
  }

  /**
   * Перевод просроченных доступов в expired.
   * Возвращает список, чтобы вызывающая задача запустила следствия (клуб и т. п.).
   */
  async expireOutdated(now = new Date()): Promise<AccessGrant[]> {
    const outdated = await this.prisma.accessGrant.findMany({
      where: { status: 'active', validUntil: { not: null, lte: now } },
    });
    if (outdated.length === 0) return [];

    await this.prisma.accessGrant.updateMany({
      where: { id: { in: outdated.map((g) => g.id) } },
      data: { status: 'expired' },
    });
    this.logger.log(`Истекло доступов: ${outdated.length}`);
    return outdated;
  }

  /** Доступы, истекающие в заданном окне — для предупреждений. */
  async findExpiringBetween(from: Date, to: Date): Promise<AccessGrant[]> {
    return this.prisma.accessGrant.findMany({
      where: { status: 'active', validUntil: { gte: from, lt: to } },
    });
  }

  private validateSubject(input: CreateGrantInput): void {
    if (input.product === 'crm' && !input.workspaceId) {
      throw AppError.validation('Доступ к CRM выдаётся мастерской');
    }
    if (input.product !== 'crm' && !input.userId) {
      throw AppError.validation('Доступ к этому продукту выдаётся пользователю');
    }
    if (input.product === 'course' && !input.courseId) {
      throw AppError.validation('Укажите курс');
    }
    if (input.validUntil && input.validFrom && input.validUntil <= input.validFrom) {
      throw AppError.validation('Дата окончания должна быть позже даты начала');
    }
  }
}
