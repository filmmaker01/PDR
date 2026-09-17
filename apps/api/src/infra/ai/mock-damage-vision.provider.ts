import { createHash } from 'node:crypto';
import type {
  DamageVisionContext,
  DamageVisionImage,
  DamageVisionProvider,
  DamageVisionResult,
} from './ai.types';

/**
 * Заглушка для локальной разработки, демо-staging и тестов.
 *
 * Отвечает детерминированно: один и тот же набор снимков даёт один и тот же
 * разбор, поэтому тест не зависит от внешней сети и от настроения модели.
 * Результат честно помечен как предварительный — он ничем не отличается по
 * форме от ответа настоящего провайдера, и интерфейс не приходится
 * подстраивать при переключении.
 */
export class MockDamageVisionProvider implements DamageVisionProvider {
  readonly name = 'mock';
  readonly available = true;

  async analyze(
    images: readonly DamageVisionImage[],
    context: DamageVisionContext,
  ): Promise<DamageVisionResult> {
    // Разбор выводится из хеша ссылок: воспроизводимо и не требует сети.
    const seed = createHash('sha256')
      .update(images.map((image) => image.url).join('|'))
      .digest();

    const panels = context.hintPanelCode
      ? [context.hintPanelCode]
      : context.allowedPanelCodes.length > 0
        ? context.allowedPanelCodes
        : ['hood'];
    const damageTypes =
      context.allowedDamageTypes.length > 0 ? context.allowedDamageTypes : ['dent'];
    const sizes = context.sizeClasses.length > 0 ? context.sizeClasses : [{ code: 'M', hint: '' }];

    const panelCode = panels[seed[0]! % panels.length]!;
    const damageType = damageTypes[seed[1]! % damageTypes.length]!;
    const sizeClass = sizes[seed[2]! % sizes.length]!.code;
    const quantity = 1 + (seed[3]! % 4);
    const widthMm = 20 + (seed[4]! % 60);

    return {
      items: [
        {
          panelCode,
          damageType,
          sizeClass,
          widthMm,
          heightMm: widthMm,
          quantity,
          confidence: 0.5,
          note: 'Демонстрационный разбор: реальный провайдер не подключён',
        },
      ],
      explanation:
        'Демонстрационный разбор фотографии. Проверьте элемент кузова, размер и стоимость вручную.',
      confidence: 0.5,
      provider: this.name,
      model: 'mock-vision-1',
      raw: { images: images.length, vehicle: context.vehicle ?? null },
    };
  }
}
