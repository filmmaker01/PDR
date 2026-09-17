import { Injectable } from '@nestjs/common';
import { Prisma, type Assessment } from '@prisma/client';
import { AppError } from '@/common/errors/app.error';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { WorkspaceScopedRepository } from '@/modules/workspaces/repositories/workspace-scoped.repository';

export type AssessmentParent = { leadId: string } | { orderId: string };

function whereParent(parent: AssessmentParent): Prisma.AssessmentWhereInput {
  return 'leadId' in parent ? { leadId: parent.leadId } : { orderId: parent.orderId };
}

const ASSESSMENT_INCLUDE = {
  items: { orderBy: { position: 'asc' } },
  createdBy: { select: { firstName: true, lastName: true } },
} satisfies Prisma.AssessmentInclude;

export type AssessmentWithItems = Prisma.AssessmentGetPayload<{
  include: typeof ASSESSMENT_INCLUDE;
}>;

@Injectable()
export class AssessmentsRepository extends WorkspaceScopedRepository {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  async listFor(workspaceId: string, parent: AssessmentParent): Promise<AssessmentWithItems[]> {
    return this.prisma.assessment.findMany({
      where: { workspaceId, ...whereParent(parent) },
      include: ASSESSMENT_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async findById(
    workspaceId: string,
    assessmentId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<AssessmentWithItems | null> {
    const client = tx ?? this.prisma;
    return client.assessment.findFirst({
      where: { id: assessmentId, workspaceId },
      include: ASSESSMENT_INCLUDE,
    });
  }

  async latestFor(
    workspaceId: string,
    parent: AssessmentParent,
    tx?: Prisma.TransactionClient,
  ): Promise<Assessment | null> {
    const client = tx ?? this.prisma;
    return client.assessment.findFirst({
      where: { workspaceId, ...whereParent(parent) },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(
    workspaceId: string,
    data: Omit<Prisma.AssessmentUncheckedCreateInput, 'workspaceId'>,
    items: Omit<Prisma.AssessmentItemUncheckedCreateInput, 'workspaceId' | 'assessmentId'>[],
    tx?: Prisma.TransactionClient,
  ): Promise<AssessmentWithItems> {
    const client = tx ?? this.prisma;
    const created = await client.assessment.create({ data: { ...data, workspaceId } });
    if (items.length > 0) {
      await client.assessmentItem.createMany({
        data: items.map((item) => ({ ...item, workspaceId, assessmentId: created.id })),
      });
    }
    const full = await this.findById(workspaceId, created.id, tx);
    if (!full) throw AppError.notFound('Оценка не найдена');
    return full;
  }

  async update(
    workspaceId: string,
    assessmentId: string,
    data: Prisma.AssessmentUncheckedUpdateInput,
    tx?: Prisma.TransactionClient,
  ): Promise<Assessment> {
    const client = tx ?? this.prisma;
    const existing = await client.assessment.findFirst({
      where: { id: assessmentId, workspaceId },
      select: { id: true },
    });
    if (!existing) throw AppError.notFound('Оценка не найдена');
    const { workspaceId: _ignored, id: _id, ...safe } = data;
    void _ignored;
    void _id;
    return client.assessment.update({ where: { id: assessmentId }, data: safe });
  }

  /** Позиции заменяются целиком: сервер пересчитывает итоги сам. */
  async replaceItems(
    workspaceId: string,
    assessmentId: string,
    items: Omit<Prisma.AssessmentItemUncheckedCreateInput, 'workspaceId' | 'assessmentId'>[],
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    await tx.assessmentItem.deleteMany({ where: { workspaceId, assessmentId } });
    if (items.length > 0) {
      await tx.assessmentItem.createMany({
        data: items.map((item) => ({ ...item, workspaceId, assessmentId })),
      });
    }
  }

  /** Перенос оценок обращения в заказ при конверсии. */
  async moveToOrder(
    workspaceId: string,
    leadId: string,
    orderId: string,
    tx: Prisma.TransactionClient,
  ): Promise<number> {
    const result = await tx.assessment.updateMany({
      where: { workspaceId, leadId },
      data: { leadId: null, orderId },
    });
    return result.count;
  }
}
