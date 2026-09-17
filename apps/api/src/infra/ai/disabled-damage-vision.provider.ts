import { AppError } from '@/common/errors/app.error';
import type {
  DamageVisionContext,
  DamageVisionImage,
  DamageVisionProvider,
  DamageVisionResult,
} from './ai.types';

/**
 * Провайдер по умолчанию: AI-оценка выключена.
 *
 * Отвечает понятным отказом вместо выдуманного результата. Всё остальное —
 * обращения, схема кузова, разметка фотографий, ручная оценка и расчёт по
 * параметрам — работает без ключа AI.
 */
export class DisabledDamageVisionProvider implements DamageVisionProvider {
  readonly name = 'disabled';
  readonly available = false;

  async analyze(
    _images: readonly DamageVisionImage[],
    _context: DamageVisionContext,
  ): Promise<DamageVisionResult> {
    throw new AppError(
      'ai_unavailable',
      'AI-оценка не подключена. Оцените вручную или рассчитайте по параметрам повреждения.',
    );
  }
}
