import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { AppError } from '@/common/errors/app.error';
import type { AppConfigService } from '@/config/config.service';
import type {
  DamageVisionContext,
  DamageVisionImage,
  DamageVisionProvider,
  DamageVisionItem,
  DamageVisionResult,
} from './ai.types';

/**
 * Адаптер к любому сервису с API вида OpenAI Chat Completions: сам OpenAI,
 * шлюзы (OpenRouter, Vercel AI Gateway), совместимые отечественные сервисы.
 *
 * Выбран именно этот протокол, а не SDK одного вендора: сменить модель —
 * значит поменять две переменные окружения, а не переписать модуль.
 * Никакой другой части приложения об этом знать не нужно.
 */

const itemSchema = z.object({
  panelCode: z.string().min(1),
  damageType: z.string().nullable().optional(),
  sizeClass: z.string().nullable().optional(),
  widthMm: z.number().finite().positive().nullable().optional(),
  heightMm: z.number().finite().positive().nullable().optional(),
  quantity: z.number().int().min(1).max(500).nullable().optional(),
  confidence: z.number().min(0).max(1).nullable().optional(),
  note: z.string().max(500).nullable().optional(),
});

const answerSchema = z.object({
  items: z.array(itemSchema).max(30),
  explanation: z.string().max(2000).optional(),
  confidence: z.number().min(0).max(1).nullable().optional(),
});

export class OpenAiDamageVisionProvider implements DamageVisionProvider {
  private readonly logger = new Logger(OpenAiDamageVisionProvider.name);
  readonly name = 'openai_compatible';

  constructor(private readonly config: AppConfigService) {}

  get available(): boolean {
    return Boolean(this.config.env.AI_API_KEY && this.config.env.AI_MODEL);
  }

  async analyze(
    images: readonly DamageVisionImage[],
    context: DamageVisionContext,
  ): Promise<DamageVisionResult> {
    if (!this.available) {
      throw new AppError(
        'ai_unavailable',
        'AI-оценка не настроена: не заданы ключ и модель. Оцените вручную или по параметрам.',
      );
    }
    if (images.length === 0) {
      throw AppError.validation('Приложите хотя бы одну фотографию повреждения');
    }

    const model = this.config.env.AI_MODEL;
    const body = {
      model,
      // Ответ нужен машине, а не человеку: просим строгий JSON.
      response_format: { type: 'json_object' as const },
      temperature: 0,
      max_tokens: 1200,
      messages: [
        { role: 'system' as const, content: this.systemPrompt(context) },
        {
          role: 'user' as const,
          content: [
            { type: 'text' as const, text: this.userPrompt(context) },
            ...images.map((image) => ({
              type: 'image_url' as const,
              image_url: { url: image.url },
            })),
          ],
        },
      ],
    };

    const raw = await this.call(body);
    const content = this.extractContent(raw);
    const parsed = this.parseAnswer(content);

    const allowedPanels = new Set(context.allowedPanelCodes);
    const allowedTypes = new Set(context.allowedDamageTypes);
    const allowedSizes = new Set(context.sizeClasses.map((size) => size.code));

    // Модель может назвать элемент кузова, которого нет в справочнике.
    // Такие строки отбрасываются: лучше короткий разбор, чем выдуманный код,
    // по которому потом не найдётся ни позиция прайса, ни деталь на схеме.
    const items: DamageVisionItem[] = parsed.items
      .filter((item) => allowedPanels.has(item.panelCode))
      .map((item) => ({
        panelCode: item.panelCode,
        damageType: item.damageType && allowedTypes.has(item.damageType) ? item.damageType : null,
        sizeClass: item.sizeClass && allowedSizes.has(item.sizeClass) ? item.sizeClass : null,
        widthMm: item.widthMm ?? null,
        heightMm: item.heightMm ?? null,
        quantity: item.quantity ?? 1,
        confidence: item.confidence ?? null,
        note: item.note ?? null,
      }));

    if (items.length === 0) {
      throw new AppError(
        'ai_failed',
        'Не удалось разобрать фотографию: на снимке не распознан элемент кузова. Оцените вручную.',
      );
    }

    return {
      items,
      explanation: parsed.explanation?.trim() || 'Разбор фотографии без пояснения',
      confidence: parsed.confidence ?? null,
      provider: this.name,
      model,
      raw,
    };
  }

  private systemPrompt(context: DamageVisionContext): string {
    const sizes = context.sizeClasses.map((s) => `${s.code} — ${s.hint}`).join('; ');
    return [
      'Ты помогаешь мастеру беспокрасочного удаления вмятин (PDR) разобрать фотографию повреждения автомобиля.',
      'Твой ответ — предварительная подсказка, а не окончательная оценка. Не называй стоимость.',
      `Элемент кузова выбирай строго из списка кодов: ${context.allowedPanelCodes.join(', ')}.`,
      `Тип повреждения выбирай строго из списка кодов: ${context.allowedDamageTypes.join(', ')}.`,
      `Размерный класс выбирай из: ${sizes}.`,
      'Если чего-то не видно на снимке — ставь null, не угадывай.',
      'Отвечай только JSON-объектом вида {"items":[{"panelCode":"...","damageType":"...","sizeClass":"...","widthMm":0,"heightMm":0,"quantity":1,"confidence":0.0,"note":"..."}],"explanation":"...","confidence":0.0}.',
      'Поле explanation — одно-два предложения по-русски: что видно на снимке и почему такой вывод.',
    ].join('\n');
  }

  private userPrompt(context: DamageVisionContext): string {
    const parts = ['Разбери повреждение на фотографиях.'];
    if (context.vehicle) parts.push(`Автомобиль: ${context.vehicle}.`);
    if (context.hintPanelCode) {
      parts.push(`Мастер отметил на схеме элемент «${context.hintPanelCode}» — проверь это.`);
    }
    return parts.join(' ');
  }

  private async call(body: unknown): Promise<unknown> {
    const base = this.config.env.AI_BASE_URL.replace(/\/$/, '');
    const timeoutMs = this.config.env.AI_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.env.AI_API_KEY}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        this.logger.warn(
          { status: response.status, body: text.slice(0, 500) },
          'Провайдер AI ответил ошибкой',
        );
        throw new AppError(
          'ai_failed',
          'Сервис AI-оценки сейчас недоступен. Оцените вручную или по параметрам.',
        );
      }
      return (await response.json()) as unknown;
    } catch (error) {
      if (error instanceof AppError) throw error;
      const aborted = error instanceof Error && error.name === 'AbortError';
      this.logger.warn({ err: error }, 'Не удалось обратиться к провайдеру AI');
      throw new AppError(
        'ai_failed',
        aborted
          ? 'Сервис AI-оценки не ответил вовремя. Оцените вручную или по параметрам.'
          : 'Сервис AI-оценки сейчас недоступен. Оцените вручную или по параметрам.',
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private extractContent(raw: unknown): string {
    const shape = z
      .object({
        choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1),
      })
      .safeParse(raw);
    if (!shape.success) {
      throw new AppError('ai_failed', 'Непонятный ответ сервиса AI-оценки. Оцените вручную.');
    }
    return shape.data.choices[0]!.message.content;
  }

  private parseAnswer(content: string): z.infer<typeof answerSchema> {
    // Модели любят оборачивать JSON в ```json … ```, даже когда их просят не делать этого.
    const cleaned = content
      .trim()
      .replace(/^```(?:json)?/i, '')
      .replace(/```$/, '')
      .trim();

    let json: unknown;
    try {
      json = JSON.parse(cleaned);
    } catch {
      throw new AppError('ai_failed', 'Сервис AI-оценки вернул не JSON. Оцените вручную.');
    }

    const parsed = answerSchema.safeParse(json);
    if (!parsed.success) {
      this.logger.warn({ issues: parsed.error.issues }, 'Ответ AI не прошёл разбор');
      throw new AppError('ai_failed', 'Не удалось разобрать ответ AI-оценки. Оцените вручную.');
    }
    return parsed.data;
  }
}
