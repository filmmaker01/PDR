import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AccessDifficulty, AssessmentMethod, Material, Prisma, User } from '@prisma/client';
import {
  BODY_PANELS,
  DAMAGE_TYPES,
  DEFAULT_PRICE_COEFFICIENT,
  SIZE_CLASSES,
  applyPriceCoefficient,
  calcAssessment,
  normalizePriceCoefficient,
  type AssessmentExtraInput,
  type AssessmentLineInput,
  type AssessmentResult,
  type PriceRule,
} from '@pdr/shared';
import { AppError } from '@/common/errors/app.error';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { DAMAGE_VISION_PROVIDER } from '@/infra/ai/ai.module';
import type { DamageVisionProvider, DamageVisionResult } from '@/infra/ai/ai.types';
import type { WorkspaceContext } from '@/modules/workspaces/workspace.types';
import { CrmParentAccess, isLeadParent, type CrmParent } from '../access/crm-parent.access';
import {
  AssessmentsRepository,
  type AssessmentWithItems,
} from '../repositories/assessments.repository';
import { DamagesRepository } from '../repositories/damages.repository';
import { LeadsRepository } from '../repositories/leads.repository';
import { PriceListRepository } from '../repositories/price-list.repository';
import { OrderPhotosService } from '../photos/order-photos.service';

export interface AssessmentItemInput {
  damageId?: string | null;
  panelCode: string;
  damageType?: string | null;
  sizeClass?: string | null;
  widthMm?: number | null;
  heightMm?: number | null;
  quantity?: number;
  material?: Material | null;
  accessDifficulty?: AccessDifficulty | null;
  onEdge?: boolean;
  /** Цена за единицу, введённая мастером. Перебивает расчёт. */
  unitPriceMinor?: number | null;
  comment?: string | null;
}

/**
 * Арматурная работа к повреждению: снятие обшивки, разбор двери, снятие фары.
 * Берётся из справочника мастерской — того же прайса, но позициями не для
 * повреждений: второго справочника и второго расчёта не появляется.
 */
export interface AssessmentExtraWorkInput {
  priceListItemId?: string | null;
  damageId?: string | null;
  title?: string | null;
  quantity?: number;
  /** Цена, введённая мастером. Перебивает справочник. */
  unitPriceMinor?: number | null;
  comment?: string | null;
}

export interface CreateAssessmentInput {
  method: AssessmentMethod;
  items?: AssessmentItemInput[];
  /** Арматурные работы: суммируются с PDR в общий итог. */
  extras?: AssessmentExtraWorkInput[];
  /** Коэффициент цены этой оценки. Без него берётся настройка мастерской. */
  priceCoefficient?: number;
  /** Итог вручную: способ manual, когда мастер просто называет сумму. */
  totalMinor?: number | null;
  note?: string | null;
  /** Снимки для разбора. Только для способа ai. */
  photoIds?: string[];
  /** Элемент кузова, отмеченный на схеме: подсказка для разбора фотографии. */
  hintPanelCode?: string | null;
  /** Переносить ли утверждённые цены в повреждения на схеме. */
  applyToDamages?: boolean;
}

/**
 * Оценка ремонта тремя способами.
 *
 * Общее для всех трёх: сервер сам считает суммы по прайсу и сам решает, что
 * считать правкой мастера. Клиент присылает параметры и — если хочет — свою
 * цену; присланные итоги не принимаются, иначе стоимость подбиралась бы
 * на стороне интерфейса.
 *
 * Результат разбора фотографии ценой не является: он лишь заполняет параметры,
 * по которым считается тот же самый расчёт по прайсу, и всегда остаётся
 * доступным для правки.
 */
@Injectable()
export class AssessmentsService {
  private readonly logger = new Logger(AssessmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly assessments: AssessmentsRepository,
    private readonly damages: DamagesRepository,
    private readonly leads: LeadsRepository,
    private readonly priceList: PriceListRepository,
    private readonly photos: OrderPhotosService,
    private readonly access: CrmParentAccess,
    @Inject(DAMAGE_VISION_PROVIDER) private readonly vision: DamageVisionProvider,
  ) {}

  /** Настроен ли разбор фотографии: интерфейс прячет кнопку, когда нет. */
  get aiAvailable(): boolean {
    return this.vision.available;
  }

  get aiProviderName(): string {
    return this.vision.name;
  }

  // ── Чтение ────────────────────────────────────────────────────────────────

  async listFor(ctx: WorkspaceContext, parent: CrmParent): Promise<AssessmentWithItems[]> {
    await this.access.assertReadable(ctx, parent);
    return this.assessments.listFor(ctx.workspaceId, parent);
  }

  async getById(ctx: WorkspaceContext, assessmentId: string): Promise<AssessmentWithItems> {
    const assessment = await this.assessments.findById(ctx.workspaceId, assessmentId);
    if (!assessment) throw AppError.notFound('Оценка не найдена');
    await this.access.assertReadable(ctx, this.parentOf(assessment));
    return assessment;
  }

  // ── Расчёт без сохранения ─────────────────────────────────────────────────

  /**
   * Предварительный расчёт по параметрам.
   *
   * Ничего не сохраняет: мастер крутит размеры и сразу видит сумму.
   * Тот же расчёт выполняется и при сохранении, поэтому «показали одно,
   * сохранили другое» невозможно.
   */
  async preview(
    ctx: WorkspaceContext,
    input: {
      items?: AssessmentItemInput[];
      extras?: AssessmentExtraWorkInput[];
      priceCoefficient?: number;
    },
  ): Promise<AssessmentResult> {
    const rules = await this.priceRules(ctx);
    this.assertExtrasKnown(input.extras ?? [], rules);
    return calcAssessment(
      (input.items ?? []).map((item) => this.toLine(item)),
      rules,
      {
        extras: (input.extras ?? []).map((extra) => this.toExtra(extra)),
        coefficientPercent: this.coefficientOf(ctx, input.priceCoefficient),
        currency: ctx.workspace.currency,
      },
    );
  }

  /**
   * Разбор фотографий и расчёт по его результату.
   *
   * Ничего не сохраняет: мастер сначала смотрит, что предложено, и только
   * потом подтверждает. Так «предварительная AI-оценка» не превращается
   * молча в сохранённую цену.
   */
  async analyzePhotos(
    ctx: WorkspaceContext,
    parent: CrmParent,
    input: { photoIds: string[]; hintPanelCode?: string | null },
    auth: { user: User; platformRoles: string[] },
  ): Promise<{
    vision: DamageVisionResult;
    calc: AssessmentResult;
    items: AssessmentItemInput[];
  }> {
    await this.access.assertWritable(ctx, parent);

    if (!this.vision.available) {
      throw new AppError(
        'ai_unavailable',
        'AI-оценка не подключена. Оцените вручную или рассчитайте по параметрам повреждения.',
      );
    }
    if (input.photoIds.length === 0) {
      throw AppError.validation('Выберите хотя бы одну фотографию повреждения');
    }
    if (input.photoIds.length > 6) {
      throw AppError.validation('За один раз разбирается не больше шести фотографий');
    }

    const images = await this.photos.originalUrls(input.photoIds, ctx, auth);
    const vehicle = await this.vehicleHint(ctx, parent);

    const vision = await this.vision.analyze(
      images.map((image) => ({ url: image.url, mimeType: image.mimeType })),
      {
        vehicle,
        allowedPanelCodes: BODY_PANELS.map((panel) => panel.code),
        allowedDamageTypes: DAMAGE_TYPES.map((type) => type.code),
        sizeClasses: SIZE_CLASSES.map((size) => ({ code: size.code, hint: size.hint })),
        hintPanelCode: input.hintPanelCode ?? null,
      },
    );

    const items: AssessmentItemInput[] = vision.items.map((item) => ({
      panelCode: item.panelCode,
      damageType: item.damageType,
      sizeClass: item.sizeClass,
      widthMm: item.widthMm,
      heightMm: item.heightMm,
      quantity: item.quantity,
      comment: item.note,
    }));

    const rules = await this.priceRules(ctx);
    return {
      vision,
      // Разбор фотографии проходит тот же путь, что и ручной ввод параметров:
      // базовый расчёт по прайсу, затем коэффициент, затем правка мастером.
      calc: calcAssessment(
        items.map((i) => this.toLine(i)),
        rules,
        {
          coefficientPercent: this.coefficientOf(ctx),
          currency: ctx.workspace.currency,
        },
      ),
      items,
    };
  }

  // ── Сохранение ────────────────────────────────────────────────────────────

  async create(
    ctx: WorkspaceContext,
    parent: CrmParent,
    input: CreateAssessmentInput,
    ai?: Pick<DamageVisionResult, 'provider' | 'model' | 'raw' | 'confidence' | 'explanation'>,
  ): Promise<AssessmentWithItems> {
    await this.access.assertWritable(ctx, parent);

    const currency = await this.access.currencyOf(ctx, parent);
    const items = input.items ?? [];
    const extras = input.extras ?? [];

    if (input.method === 'manual' && items.length === 0 && extras.length === 0) {
      return this.createManual(ctx, parent, currency, input);
    }
    if (items.length === 0 && extras.length === 0) {
      throw AppError.validation('Добавьте хотя бы одно повреждение или укажите сумму вручную');
    }
    if (items.length > 60) throw AppError.validation('Слишком много позиций в оценке');
    if (extras.length > 30) throw AppError.validation('Слишком много арматурных работ в оценке');

    await this.assertDamagesBelong(ctx, parent, [...items, ...extras]);

    const rules = await this.priceRules(ctx);
    this.assertExtrasKnown(extras, rules);
    const coefficientPercent = this.coefficientOf(ctx, input.priceCoefficient);
    const calc = calcAssessment(
      items.map((item) => this.toLine(item)),
      rules,
      {
        extras: extras.map((extra) => this.toExtra(extra)),
        coefficientPercent,
        currency,
      },
    );

    // Итог можно перебить целиком: мастер округляет сумму «по-человечески».
    //
    // Присланный итог принимается, только если он согласуется со строками:
    // интерфейс подставляет его сразу после расчёта, и если потом поправить
    // цену строки, а итог не тронуть, сохранилась бы сумма, противоречащая
    // собственной расшифровке. В такой ситуации выигрывают строки — их
    // мастер правил позже и осознаннее, чем автоподставленное число.
    const requested =
      input.totalMinor === null || input.totalMinor === undefined
        ? null
        : Math.max(0, Math.trunc(input.totalMinor));
    const linesOverridden =
      calc.lines.some((line) => line.overridden) || calc.extras.some((extra) => extra.overridden);
    const totalOverride =
      requested !== null && linesOverridden && requested === calc.suggestedMinor ? null : requested;

    const totalMinor = totalOverride ?? calc.totalMinor;
    // Отступление от расчёта — это и правка итога, и правка любой строки.
    const overridden =
      linesOverridden || (totalOverride !== null && totalOverride !== calc.suggestedMinor);

    const saved = await this.prisma.transaction(async (tx) => {
      const assessment = await this.assessments.create(
        ctx.workspaceId,
        {
          ...(isLeadParent(parent) ? { leadId: parent.leadId } : { orderId: parent.orderId }),
          method: input.method,
          currency,
          suggestedMinor: BigInt(calc.suggestedMinor),
          baseMinor: BigInt(calc.pdrBaseMinor),
          priceCoefficient: calc.coefficientPercent,
          extrasMinor: BigInt(calc.extrasMinor),
          totalMinor: BigInt(totalMinor),
          overridden,
          explanation: ai?.explanation ?? calc.explanation,
          note: input.note ?? null,
          aiProvider: ai?.provider ?? null,
          aiModel: ai?.model ?? null,
          aiRaw: (ai?.raw as Prisma.InputJsonValue | undefined) ?? undefined,
          aiConfidence: ai?.confidence ?? null,
          createdById: ctx.userId,
        },
        this.itemRows(calc, items),
        tx,
      );

      if (input.applyToDamages !== false) {
        await this.applyToDamages(ctx, calc, input.method, tx);
      }
      await this.syncLeadEstimate(ctx, parent, totalMinor, tx);

      return assessment;
    });

    return saved;
  }

  /** Ручная оценка без разбора на позиции: мастер просто называет стоимость. */
  private async createManual(
    ctx: WorkspaceContext,
    parent: CrmParent,
    currency: string,
    input: CreateAssessmentInput,
  ): Promise<AssessmentWithItems> {
    if (input.totalMinor === null || input.totalMinor === undefined) {
      throw AppError.validation('Укажите стоимость');
    }
    const totalMinor = Math.max(0, Math.trunc(input.totalMinor));

    return this.prisma.transaction(async (tx) => {
      const assessment = await this.assessments.create(
        ctx.workspaceId,
        {
          ...(isLeadParent(parent) ? { leadId: parent.leadId } : { orderId: parent.orderId }),
          method: 'manual',
          currency,
          suggestedMinor: BigInt(0),
          // Названную сумму коэффициент не трогает: мастер уже сказал цену.
          baseMinor: BigInt(0),
          priceCoefficient: DEFAULT_PRICE_COEFFICIENT,
          extrasMinor: BigInt(0),
          totalMinor: BigInt(totalMinor),
          overridden: true,
          explanation: 'Стоимость назначена мастером',
          note: input.note ?? null,
          createdById: ctx.userId,
        },
        [],
        tx,
      );
      await this.syncLeadEstimate(ctx, parent, totalMinor, tx);
      return assessment;
    });
  }

  /**
   * Правка сохранённой оценки.
   *
   * Правится всё: параметры каждой позиции, цена строки и итоговая сумма.
   * Предложенный расчёт при этом сохраняется — видно, от чего отступили.
   */
  async update(
    ctx: WorkspaceContext,
    assessmentId: string,
    input: {
      items?: AssessmentItemInput[];
      extras?: AssessmentExtraWorkInput[];
      priceCoefficient?: number;
      totalMinor?: number | null;
      note?: string | null;
    },
  ): Promise<AssessmentWithItems> {
    const assessment = await this.getById(ctx, assessmentId);
    const parent = this.parentOf(assessment);
    await this.access.assertWritable(ctx, parent);

    // Позиции и работы перечитываются из сохранённой оценки, когда их не
    // присылали: правка одного коэффициента не должна обнулять состав.
    const items = input.items ?? this.savedLines(assessment);
    const extras = input.extras ?? this.savedExtras(assessment);
    const rewritesComposition = Boolean(input.items || input.extras);

    if (items.length > 0 || extras.length > 0) {
      await this.assertDamagesBelong(ctx, parent, [...items, ...extras]);
    }

    const rules = await this.priceRules(ctx);
    this.assertExtrasKnown(extras, rules);
    const calc = calcAssessment(
      items.map((item) => this.toLine(item)),
      rules,
      {
        extras: extras.map((extra) => this.toExtra(extra)),
        coefficientPercent:
          input.priceCoefficient === undefined
            ? assessment.priceCoefficient
            : normalizePriceCoefficient(input.priceCoefficient),
        currency: assessment.currency,
      },
    );

    const totalOverride =
      input.totalMinor === null || input.totalMinor === undefined
        ? null
        : Math.max(0, Math.trunc(input.totalMinor));
    const hasComposition = items.length > 0 || extras.length > 0;
    const totalMinor =
      totalOverride ?? (hasComposition ? calc.totalMinor : Number(assessment.totalMinor));

    await this.prisma.transaction(async (tx) => {
      if (rewritesComposition) {
        await this.assessments.replaceItems(
          ctx.workspaceId,
          assessmentId,
          this.itemRows(calc, items),
          tx,
        );
      }
      if (hasComposition) {
        await this.applyToDamages(ctx, calc, assessment.method, tx);
      }

      await this.assessments.update(
        ctx.workspaceId,
        assessmentId,
        {
          ...(hasComposition
            ? {
                suggestedMinor: BigInt(calc.suggestedMinor),
                baseMinor: BigInt(calc.pdrBaseMinor),
                extrasMinor: BigInt(calc.extrasMinor),
              }
            : {}),
          priceCoefficient: calc.coefficientPercent,
          totalMinor: BigInt(totalMinor),
          // Любая ручная правка — это отступление от расчёта. Отметка нужна,
          // чтобы в интерфейсе не выдавать её за «предварительную AI-оценку».
          overridden: true,
          ...(input.note !== undefined ? { note: input.note } : {}),
        },
        tx,
      );

      await this.syncLeadEstimate(ctx, parent, totalMinor, tx);
    });

    return this.getById(ctx, assessmentId);
  }

  // ── Вспомогательное ───────────────────────────────────────────────────────

  private parentOf(assessment: { leadId: string | null; orderId: string | null }): CrmParent {
    if (assessment.leadId) return { leadId: assessment.leadId };
    if (assessment.orderId) return { orderId: assessment.orderId };
    throw AppError.notFound('Оценка не найдена');
  }

  /** Коэффициент оценки: присланный или привычный для мастерской. */
  private coefficientOf(ctx: WorkspaceContext, requested?: number | null): number {
    if (requested !== undefined && requested !== null) return normalizePriceCoefficient(requested);
    return normalizePriceCoefficient(
      ctx.settings.default_price_coefficient ?? DEFAULT_PRICE_COEFFICIENT,
    );
  }

  /** Позиции сохранённой оценки как вход расчёта: PDR-строки. */
  private savedLines(assessment: AssessmentWithItems): AssessmentItemInput[] {
    return assessment.items
      .filter((item) => item.kind === 'damage')
      .map((item) => ({
        damageId: item.damageId,
        panelCode: item.panelCode ?? 'other',
        damageType: item.damageType,
        sizeClass: item.sizeClass,
        widthMm: item.widthMm,
        heightMm: item.heightMm,
        quantity: item.quantity,
        material: item.material,
        accessDifficulty: item.accessDifficulty,
        onEdge: item.onEdge,
        unitPriceMinor: Number(item.unitPriceMinor),
        comment: item.comment,
      }));
  }

  /** Позиции сохранённой оценки как вход расчёта: арматурные работы. */
  private savedExtras(assessment: AssessmentWithItems): AssessmentExtraWorkInput[] {
    return assessment.items
      .filter((item) => item.kind !== 'damage')
      .map((item) => ({
        priceListItemId: item.priceListItemId,
        damageId: item.damageId,
        title: item.title,
        quantity: item.quantity,
        unitPriceMinor: Number(item.unitPriceMinor),
        comment: item.comment,
      }));
  }

  private toExtra(extra: AssessmentExtraWorkInput): AssessmentExtraInput {
    return {
      priceListItemId: extra.priceListItemId ?? null,
      damageId: extra.damageId ?? null,
      title: extra.title ?? '',
      quantity: extra.quantity ?? 1,
      unitPriceMinor: extra.unitPriceMinor ?? null,
      comment: extra.comment ?? null,
    };
  }

  /**
   * Позиция справочника обязана существовать и не быть позицией повреждения:
   * иначе «арматурная работа» молча получила бы цену ремонта вмятины.
   */
  private assertExtrasKnown(
    extras: readonly AssessmentExtraWorkInput[],
    rules: readonly PriceRule[],
  ): void {
    for (const extra of extras) {
      if (!extra.priceListItemId) {
        if (!extra.title?.trim()) {
          throw AppError.validation('Назовите арматурную работу или выберите её из справочника');
        }
        continue;
      }
      const rule = rules.find((r) => r.id === extra.priceListItemId);
      if (!rule || rule.kind === 'damage') {
        throw AppError.validation('Арматурная работа не найдена в справочнике мастерской');
      }
    }
  }

  /** Строки оценки для базы: сначала PDR, затем арматурные работы. */
  private itemRows(
    calc: AssessmentResult,
    items: readonly AssessmentItemInput[],
  ): Parameters<AssessmentsRepository['create']>[2] {
    return [
      ...calc.lines.map((line, index) => ({
        damageId: line.damageId,
        kind: 'damage' as const,
        title: null,
        position: line.position,
        panelCode: line.panelCode,
        damageType: line.damageType,
        sizeClass: line.sizeClass,
        widthMm: items[index]?.widthMm ?? null,
        heightMm: items[index]?.heightMm ?? null,
        quantity: line.quantity,
        material: items[index]?.material ?? null,
        accessDifficulty: items[index]?.accessDifficulty ?? null,
        onEdge: items[index]?.onEdge ?? false,
        suggestedUnitPriceMinor: BigInt(line.suggestedUnitPriceMinor),
        unitPriceMinor: BigInt(line.unitPriceMinor),
        lineTotalMinor: BigInt(line.lineTotalMinor),
        priceListItemId: line.priceListItemId,
        confidence: null,
        comment: line.comment,
      })),
      ...calc.extras.map((extra) => ({
        damageId: extra.damageId,
        kind: 'disassembly' as const,
        title: extra.title,
        position: calc.lines.length + extra.position,
        panelCode: null,
        damageType: null,
        sizeClass: null,
        widthMm: null,
        heightMm: null,
        quantity: extra.quantity,
        material: null,
        accessDifficulty: null,
        onEdge: false,
        suggestedUnitPriceMinor: BigInt(extra.suggestedUnitPriceMinor),
        unitPriceMinor: BigInt(extra.unitPriceMinor),
        lineTotalMinor: BigInt(extra.lineTotalMinor),
        priceListItemId: extra.priceListItemId,
        confidence: null,
        comment: extra.comment,
      })),
    ];
  }

  private toLine(item: AssessmentItemInput): AssessmentLineInput {
    return {
      damageId: item.damageId ?? null,
      panelCode: item.panelCode,
      damageType: item.damageType ?? null,
      sizeClass: item.sizeClass ?? null,
      widthMm: item.widthMm ?? null,
      heightMm: item.heightMm ?? null,
      quantity: item.quantity ?? 1,
      material: item.material ?? null,
      accessDifficulty: item.accessDifficulty ?? null,
      onEdge: item.onEdge ?? false,
      unitPriceMinor: item.unitPriceMinor ?? null,
      comment: item.comment ?? null,
    };
  }

  private async priceRules(ctx: WorkspaceContext): Promise<PriceRule[]> {
    const items = await this.priceList.list(ctx.workspaceId, false);
    return items.map((item) => ({
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
  }

  /** Повреждение из оценки обязано принадлежать той же карточке. */
  private async assertDamagesBelong(
    ctx: WorkspaceContext,
    parent: CrmParent,
    items: readonly { damageId?: string | null }[],
  ): Promise<void> {
    const ids = items.map((item) => item.damageId).filter((id): id is string => Boolean(id));
    if (ids.length === 0) return;
    const found = await this.damages.findManyByIds(ctx.workspaceId, ids);
    if (found.length !== new Set(ids).size) {
      throw AppError.validation('Повреждение не найдено');
    }
    const ok = found.every((damage) =>
      isLeadParent(parent) ? damage.leadId === parent.leadId : damage.orderId === parent.orderId,
    );
    if (!ok) throw AppError.validation('Повреждение относится к другой карточке');
  }

  /** Утверждённые цены переезжают в повреждения на схеме: там их и смотрят. */
  private async applyToDamages(
    ctx: WorkspaceContext,
    calc: AssessmentResult,
    method: AssessmentMethod,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    for (const line of calc.lines) {
      if (!line.damageId) continue;
      await this.damages.update(
        ctx.workspaceId,
        line.damageId,
        {
          // Цена повреждения — уже с коэффициентом: иначе сумма по схеме
          // кузова не сходилась бы с итогом оценки.
          priceMinor: BigInt(applyPriceCoefficient(line.lineTotalMinor, calc.coefficientPercent)),
          // Правка мастера делает цену ручной, чем бы её ни предложили:
          // «предварительная AI-оценка» не должна оставаться подписью
          // под суммой, которую человек уже поменял.
          priceSource: line.overridden ? 'manual' : method === 'ai' ? 'ai' : 'params',
        },
        tx,
      );
    }
  }

  /** Предварительная оценка обращения — итог последней сохранённой оценки. */
  private async syncLeadEstimate(
    ctx: WorkspaceContext,
    parent: CrmParent,
    totalMinor: number,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    if (!isLeadParent(parent)) return;
    const lead = await this.leads.findById(ctx.workspaceId, parent.leadId, tx);
    if (!lead) return;

    await this.leads.update(
      ctx.workspaceId,
      parent.leadId,
      {
        estimateMinor: BigInt(totalMinor),
        // Первая оценка двигает обращение по воронке сама: отдельная кнопка
        // «пометить оценённым» после сделанной оценки — лишний шаг.
        ...(lead.status === 'new' ? { status: 'estimated' as const } : {}),
      },
      tx,
    );

    if (lead.status === 'new') {
      await this.leads.addHistory(
        ctx.workspaceId,
        {
          leadId: parent.leadId,
          fromStatus: 'new',
          toStatus: 'estimated',
          changedById: ctx.userId,
          comment: 'Сделана предварительная оценка',
        },
        tx,
      );
    }
  }

  private async vehicleHint(ctx: WorkspaceContext, parent: CrmParent): Promise<string | null> {
    if (isLeadParent(parent)) {
      const lead = await this.leads.findById(ctx.workspaceId, parent.leadId);
      if (!lead) return null;
      const known = [lead.vehicleMake, lead.vehicleModel].filter(Boolean).join(' ').trim();
      return known || null;
    }
    const order = await this.access.readableOrder(ctx, parent.orderId);
    if (!order.vehicle) return null;
    return `${order.vehicle.make} ${order.vehicle.model}`.trim() || null;
  }
}
