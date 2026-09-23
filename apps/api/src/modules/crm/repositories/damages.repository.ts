import { Injectable } from '@nestjs/common';
import { Prisma, type Damage, type DamageExtraWork } from '@prisma/client';
import { AppError } from '@/common/errors/app.error';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { WorkspaceScopedRepository } from '@/modules/workspaces/repositories/workspace-scoped.repository';

/** Повреждение принадлежит либо обращению, либо заказу — так же, как в базе. */
export type DamageParent = { leadId: string } | { orderId: string };

function whereParent(parent: DamageParent): Prisma.DamageWhereInput {
  return 'leadId' in parent ? { leadId: parent.leadId } : { orderId: parent.orderId };
}

@Injectable()
export class DamagesRepository extends WorkspaceScopedRepository {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  async listFor(
    workspaceId: string,
    parent: DamageParent,
    tx?: Prisma.TransactionClient,
  ): Promise<Damage[]> {
    const client = tx ?? this.prisma;
    return client.damage.findMany({
      where: { workspaceId, ...whereParent(parent) },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async findById(
    workspaceId: string,
    damageId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<Damage | null> {
    const client = tx ?? this.prisma;
    return client.damage.findFirst({ where: { id: damageId, workspaceId } });
  }

  async findManyByIds(
    workspaceId: string,
    ids: readonly string[],
    tx?: Prisma.TransactionClient,
  ): Promise<Damage[]> {
    if (ids.length === 0) return [];
    const client = tx ?? this.prisma;
    return client.damage.findMany({ where: { workspaceId, id: { in: [...ids] } } });
  }

  async countFor(workspaceId: string, parent: DamageParent): Promise<number> {
    return this.prisma.damage.count({ where: { workspaceId, ...whereParent(parent) } });
  }

  async nextPosition(workspaceId: string, parent: DamageParent, tx?: Prisma.TransactionClient) {
    const client = tx ?? this.prisma;
    const last = await client.damage.findFirst({
      where: { workspaceId, ...whereParent(parent) },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    return (last?.position ?? 0) + 1;
  }

  /** Арматурные работы повреждений: карточка и документы показывают их вместе. */
  async listExtraWorks(
    workspaceId: string,
    damageIds: readonly string[],
    tx?: Prisma.TransactionClient,
  ): Promise<DamageExtraWork[]> {
    if (damageIds.length === 0) return [];
    const client = tx ?? this.prisma;
    return client.damageExtraWork.findMany({
      where: { workspaceId, damageId: { in: [...damageIds] } },
      orderBy: [{ damageId: 'asc' }, { position: 'asc' }],
    });
  }

  /**
   * Замена набора работ повреждения целиком.
   *
   * Карточка повреждения присылает список таким, каким мастер его видит:
   * добавил, убрал, поправил цену. Сравнивать построчно здесь незачем —
   * состав маленький, а правка частичным набором давала бы расхождение
   * с тем, что на экране.
   */
  async replaceExtraWorks(
    workspaceId: string,
    damageId: string,
    works: Omit<Prisma.DamageExtraWorkUncheckedCreateInput, 'workspaceId' | 'damageId'>[],
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    await tx.damageExtraWork.deleteMany({ where: { workspaceId, damageId } });
    if (works.length > 0) {
      await tx.damageExtraWork.createMany({
        data: works.map((work) => ({ ...work, workspaceId, damageId })),
      });
    }
  }

  async create(
    workspaceId: string,
    data: Omit<Prisma.DamageUncheckedCreateInput, 'workspaceId'>,
    tx?: Prisma.TransactionClient,
  ): Promise<Damage> {
    const client = tx ?? this.prisma;
    return client.damage.create({ data: { ...data, workspaceId } });
  }

  async update(
    workspaceId: string,
    damageId: string,
    data: Prisma.DamageUncheckedUpdateInput,
    tx?: Prisma.TransactionClient,
  ): Promise<Damage> {
    const client = tx ?? this.prisma;
    const existing = await client.damage.findFirst({
      where: { id: damageId, workspaceId },
      select: { id: true },
    });
    if (!existing) throw AppError.notFound('Повреждение не найдено');
    const { workspaceId: _ignored, id: _id, ...safe } = data;
    void _ignored;
    void _id;
    return client.damage.update({ where: { id: damageId }, data: safe });
  }

  /**
   * Удаление повреждения.
   *
   * Снимки и позиции оценок ссылаются на него составным ключом с workspace_id,
   * который база обнулить не может. Поэтому ссылки снимаются здесь, в одной
   * транзакции: снимок остаётся в заказе, просто перестаёт быть привязан
   * к удалённой детали.
   */
  async delete(workspaceId: string, damageId: string): Promise<void> {
    await this.prisma.transaction(async (tx) => {
      await tx.orderPhoto.updateMany({
        where: { workspaceId, damageId },
        data: { damageId: null },
      });
      await tx.assessmentItem.updateMany({
        where: { workspaceId, damageId },
        data: { damageId: null },
      });
      await tx.damage.deleteMany({ where: { workspaceId, id: damageId } });
    });
  }

  /**
   * Перенос повреждений обращения в заказ при конверсии.
   * Именно перенос, а не копирование: иначе одно и то же повреждение
   * существовало бы дважды и расходилось бы при правках.
   */
  async moveToOrder(
    workspaceId: string,
    leadId: string,
    orderId: string,
    tx: Prisma.TransactionClient,
  ): Promise<number> {
    const result = await tx.damage.updateMany({
      where: { workspaceId, leadId },
      data: { leadId: null, orderId },
    });
    return result.count;
  }
}
