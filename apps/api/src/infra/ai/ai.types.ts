/**
 * Разбор фотографии повреждения за адаптером.
 *
 * Продукт не привязан к конкретной модели: провайдер выбирается переменной
 * окружения, а весь остальной код — модель данных, API и интерфейс — работает
 * одинаково с любым из них и без них вовсе. Пока ключа нет, адаптер
 * `disabled` честно отвечает отказом, а ручная оценка и расчёт по параметрам
 * продолжают работать.
 *
 * Результат разбора никогда не является ценой. Он предлагает элемент кузова,
 * тип и размер повреждения; окончательную сумму утверждает мастер.
 */

export interface DamageVisionImage {
  /** Подписанная ссылка на снимок. Живёт минуты: провайдер скачивает её сам. */
  url: string;
  mimeType: string;
}

export interface DamageVisionContext {
  /** Марка и модель: подсказывают провайдеру геометрию кузова. */
  vehicle?: string | null;
  /** Коды элементов кузова, из которых разрешено выбирать. */
  allowedPanelCodes: readonly string[];
  /** Коды типов повреждений, из которых разрешено выбирать. */
  allowedDamageTypes: readonly string[];
  /** Размерная сетка мастерской: S/M/L/XL с подписями. */
  sizeClasses: readonly { code: string; hint: string }[];
  /** Элемент кузова, если мастер уже отметил его на схеме. */
  hintPanelCode?: string | null;
}

export interface DamageVisionItem {
  /** Код из allowedPanelCodes. Провайдер обязан выбрать из списка. */
  panelCode: string;
  damageType: string | null;
  sizeClass: string | null;
  /** Приблизительные габариты области повреждения в миллиметрах. */
  widthMm: number | null;
  heightMm: number | null;
  /** Сколько вмятин видно на элементе. */
  quantity: number;
  /** Уверенность разбора, 0–1. */
  confidence: number | null;
  note: string | null;
}

export interface DamageVisionResult {
  items: DamageVisionItem[];
  /** Краткое объяснение: почему разбор выглядит именно так. */
  explanation: string;
  /** Общая уверенность, 0–1. */
  confidence: number | null;
  provider: string;
  model: string;
  /** Сырой ответ: нужен, чтобы разобрать спорный случай позже. */
  raw: unknown;
}

export interface DamageVisionProvider {
  /** Имя адаптера. Попадает в сохранённую оценку. */
  readonly name: string;
  /** Настроен ли провайдер. Интерфейс прячет кнопку AI, когда нет. */
  readonly available: boolean;
  analyze(
    images: readonly DamageVisionImage[],
    context: DamageVisionContext,
  ): Promise<DamageVisionResult>;
}
