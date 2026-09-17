import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Idempotent } from '@/common/interceptors/idempotency.interceptor';
import { zodBody } from '@/common/pipes/zod-validation.pipe';
import { CurrentAuth, type AuthContext } from '@/modules/auth/decorators/auth.decorators';
import { Audited } from '@/modules/audit/audit.interceptor';
import { AllowExpiredAccess, Can, Workspace } from '@/modules/workspaces/guards/workspace.guard';
import { Ws } from '@/modules/workspaces/decorators/workspace.decorators';
import type { WorkspaceContext } from '@/modules/workspaces/workspace.types';
import { AssessmentsService } from './assessments.service';
import type { AssessmentWithItems } from '../repositories/assessments.repository';
import type { CrmParent } from '../access/crm-parent.access';
import {
  assessmentAnalyzeSchema,
  assessmentPreviewSchema,
  createAssessmentSchema,
  updateAssessmentSchema,
} from '../dto/leads.dto';

const METHOD_LABELS: Record<string, string> = {
  manual: 'Вручную',
  params: 'По параметрам повреждения',
  // Подпись намеренно не «AI-оценка»: в интерфейсе число всегда сопровождается
  // словом «предварительная», чтобы его не принимали за окончательную цену.
  ai: 'Предварительная AI-оценка',
};

function serializeAssessment(assessment: AssessmentWithItems): Record<string, unknown> {
  return {
    id: assessment.id,
    leadId: assessment.leadId,
    orderId: assessment.orderId,
    method: assessment.method,
    methodLabel: METHOD_LABELS[assessment.method] ?? assessment.method,
    currency: assessment.currency,
    suggestedMinor: Number(assessment.suggestedMinor),
    totalMinor: Number(assessment.totalMinor),
    overridden: assessment.overridden,
    explanation: assessment.explanation,
    note: assessment.note,
    ai: assessment.aiProvider
      ? {
          provider: assessment.aiProvider,
          model: assessment.aiModel,
          confidence: assessment.aiConfidence,
        }
      : null,
    createdAt: assessment.createdAt.toISOString(),
    createdBy: assessment.createdBy
      ? [assessment.createdBy.firstName, assessment.createdBy.lastName].filter(Boolean).join(' ')
      : null,
    items: assessment.items.map((item) => ({
      id: item.id,
      damageId: item.damageId,
      position: item.position,
      panelCode: item.panelCode,
      damageType: item.damageType,
      sizeClass: item.sizeClass,
      widthMm: item.widthMm,
      heightMm: item.heightMm,
      quantity: item.quantity,
      material: item.material,
      accessDifficulty: item.accessDifficulty,
      onEdge: item.onEdge,
      suggestedUnitPriceMinor: Number(item.suggestedUnitPriceMinor),
      unitPriceMinor: Number(item.unitPriceMinor),
      lineTotalMinor: Number(item.lineTotalMinor),
      priceListItemId: item.priceListItemId,
      confidence: item.confidence,
      comment: item.comment,
    })),
  };
}

@ApiTags('crm')
@Controller('workspaces/:workspaceId')
@Workspace()
export class AssessmentsController {
  constructor(private readonly assessments: AssessmentsService) {}

  @Get('assessments/capabilities')
  @Can('workspace.read')
  @AllowExpiredAccess()
  @ApiOperation({ summary: 'Какие способы оценки доступны в этой установке' })
  capabilities() {
    return {
      methods: [
        { value: 'manual', label: METHOD_LABELS.manual, available: true },
        { value: 'params', label: METHOD_LABELS.params, available: true },
        {
          value: 'ai',
          label: METHOD_LABELS.ai,
          // Без настроенного провайдера кнопка AI не показывается, а ручная
          // оценка и расчёт по прайсу работают как обычно.
          available: this.assessments.aiAvailable,
          provider: this.assessments.aiProviderName,
        },
      ],
    };
  }

  @Post('assessments/preview')
  @Can('price_list.read')
  @ApiOperation({ summary: 'Расчёт по параметрам повреждения без сохранения' })
  async preview(
    @Ws() ws: WorkspaceContext,
    @Body(zodBody(assessmentPreviewSchema)) body: { items: never[] },
  ) {
    const calc = await this.assessments.preview(ws, body.items);
    return {
      suggestedMinor: calc.suggestedMinor,
      totalMinor: calc.totalMinor,
      explanation: calc.explanation,
      lines: calc.lines,
      currency: ws.workspace.currency,
    };
  }

  // ── Обращение ─────────────────────────────────────────────────────────────

  @Get('leads/:leadId/assessments')
  @Can('leads.read')
  @AllowExpiredAccess()
  @ApiOperation({ summary: 'Оценки обращения' })
  async listForLead(@Ws() ws: WorkspaceContext, @Param('leadId') leadId: string) {
    const items = await this.assessments.listFor(ws, { leadId });
    return { items: items.map(serializeAssessment) };
  }

  @Post('leads/:leadId/assessments')
  @Can('leads.write')
  @Idempotent()
  @Audited({ entityType: 'assessment', action: 'create', idFrom: { responseField: 'id' } })
  @ApiOperation({ summary: 'Сохранить оценку обращения' })
  async createForLead(
    @Ws() ws: WorkspaceContext,
    @Param('leadId') leadId: string,
    @Body(zodBody(createAssessmentSchema)) body: Record<string, never>,
  ) {
    return this.create(ws, { leadId }, body);
  }

  @Post('leads/:leadId/assessments/analyze')
  @Can('leads.write')
  @ApiOperation({ summary: 'Предварительный разбор фотографий обращения' })
  async analyzeLead(
    @Ws() ws: WorkspaceContext,
    @Param('leadId') leadId: string,
    @Body(zodBody(assessmentAnalyzeSchema)) body: Record<string, never>,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.analyze(ws, { leadId }, body, auth);
  }

  // ── Заказ ─────────────────────────────────────────────────────────────────

  @Get('orders/:orderId/assessments')
  @Can('orders.read_own')
  @AllowExpiredAccess()
  @ApiOperation({ summary: 'Оценки заказа' })
  async listForOrder(@Ws() ws: WorkspaceContext, @Param('orderId') orderId: string) {
    const items = await this.assessments.listFor(ws, { orderId });
    return { items: items.map(serializeAssessment) };
  }

  @Post('orders/:orderId/assessments')
  @Can('orders.write_own')
  @Idempotent()
  @Audited({ entityType: 'assessment', action: 'create', idFrom: { responseField: 'id' } })
  @ApiOperation({ summary: 'Сохранить оценку заказа' })
  async createForOrder(
    @Ws() ws: WorkspaceContext,
    @Param('orderId') orderId: string,
    @Body(zodBody(createAssessmentSchema)) body: Record<string, never>,
  ) {
    return this.create(ws, { orderId }, body);
  }

  @Post('orders/:orderId/assessments/analyze')
  @Can('orders.write_own')
  @ApiOperation({ summary: 'Предварительный разбор фотографий заказа' })
  async analyzeOrder(
    @Ws() ws: WorkspaceContext,
    @Param('orderId') orderId: string,
    @Body(zodBody(assessmentAnalyzeSchema)) body: Record<string, never>,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.analyze(ws, { orderId }, body, auth);
  }

  // ── Общее ─────────────────────────────────────────────────────────────────

  @Get('assessments/:assessmentId')
  @Can('workspace.read')
  @AllowExpiredAccess()
  @ApiOperation({ summary: 'Оценка' })
  async get(@Ws() ws: WorkspaceContext, @Param('assessmentId') assessmentId: string) {
    return serializeAssessment(await this.assessments.getById(ws, assessmentId));
  }

  // Оценка принадлежит либо обращению, либо заказу, и по адресу это неизвестно:
  // право на маршруте минимальное, настоящую проверку делает сервис.
  @Patch('assessments/:assessmentId')
  @Can('workspace.read')
  @Audited({ entityType: 'assessment', idFrom: { param: 'assessmentId' } })
  @ApiOperation({ summary: 'Ручная правка значений и итоговой суммы' })
  async update(
    @Ws() ws: WorkspaceContext,
    @Param('assessmentId') assessmentId: string,
    @Body(zodBody(updateAssessmentSchema)) body: Record<string, never>,
  ) {
    return serializeAssessment(await this.assessments.update(ws, assessmentId, body as never));
  }

  private async create(
    ws: WorkspaceContext,
    parent: CrmParent,
    body: Record<string, never>,
  ): Promise<Record<string, unknown>> {
    const input = body as unknown as Parameters<AssessmentsService['create']>[2] & {
      ai?: Parameters<AssessmentsService['create']>[3];
    };
    const saved = await this.assessments.create(ws, parent, input, input.ai);
    return serializeAssessment(saved);
  }

  private async analyze(
    ws: WorkspaceContext,
    parent: CrmParent,
    body: Record<string, never>,
    auth: AuthContext,
  ) {
    const input = body as unknown as { photoIds: string[]; hintPanelCode?: string | null };
    const result = await this.assessments.analyzePhotos(ws, parent, input, auth);

    return {
      // Подпись приходит с сервера, чтобы её нельзя было потерять в интерфейсе.
      label: METHOD_LABELS.ai,
      disclaimer:
        'Это предварительная оценка по фотографии. Проверьте элемент кузова, размер и стоимость — итоговую сумму назначает мастер.',
      ai: {
        provider: result.vision.provider,
        model: result.vision.model,
        confidence: result.vision.confidence,
        explanation: result.vision.explanation,
        raw: result.vision.raw,
      },
      items: result.items,
      suggestedMinor: result.calc.suggestedMinor,
      totalMinor: result.calc.totalMinor,
      lines: result.calc.lines,
      currency: ws.workspace.currency,
    };
  }
}
