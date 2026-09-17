-- Инварианты обращений, повреждений и оценок.
--
-- Prisma не умеет выражать «ровно одна из двух ссылок», а именно на этом
-- держится отсутствие дублирования: повреждение, снимок и оценка живут либо
-- у обращения, либо у заказа. При конверсии ссылка переставляется, а не
-- копируется, поэтому проверка должна быть в базе, а не только в сервисе.

ALTER TABLE "damages"
    ADD CONSTRAINT "damages_one_parent"
    CHECK (("lead_id" IS NULL) <> ("order_id" IS NULL));

ALTER TABLE "assessments"
    ADD CONSTRAINT "assessments_one_parent"
    CHECK (("lead_id" IS NULL) <> ("order_id" IS NULL));

ALTER TABLE "order_photos"
    ADD CONSTRAINT "order_photos_one_parent"
    CHECK (("lead_id" IS NULL) <> ("order_id" IS NULL));

-- Один и тот же файл не прикрепляется к обращению дважды: повторный тап
-- по кнопке загрузки не должен давать вторую карточку снимка.
CREATE UNIQUE INDEX "order_photos_lead_id_file_id_key"
    ON "order_photos"("lead_id", "file_id")
    WHERE "lead_id" IS NOT NULL;

-- Разметка не может ссылаться на сам оригинал: иначе сведённая картинка
-- затёрла бы исходный снимок, и доказать согласованное повреждение было бы нечем.
ALTER TABLE "order_photos"
    ADD CONSTRAINT "order_photos_annotation_not_original"
    CHECK ("annotation_file_id" IS NULL OR "annotation_file_id" <> "file_id");

-- Обращение считается превращённым в заказ только вместе с отметкой времени.
ALTER TABLE "leads"
    ADD CONSTRAINT "leads_converted_consistent"
    CHECK (("converted_order_id" IS NULL) = ("converted_at" IS NULL));

-- Размеры повреждения — положительные миллиметры, количество — не меньше одного.
ALTER TABLE "damages"
    ADD CONSTRAINT "damages_positive_size"
    CHECK (
        ("width_mm" IS NULL OR "width_mm" > 0)
        AND ("height_mm" IS NULL OR "height_mm" > 0)
        AND "quantity" >= 1
    );

-- Уверенность разбора фотографии — доля, а не проценты.
ALTER TABLE "assessments"
    ADD CONSTRAINT "assessments_confidence_range"
    CHECK ("ai_confidence" IS NULL OR ("ai_confidence" >= 0 AND "ai_confidence" <= 1));

ALTER TABLE "assessment_items"
    ADD CONSTRAINT "assessment_items_confidence_range"
    CHECK ("confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 1));
