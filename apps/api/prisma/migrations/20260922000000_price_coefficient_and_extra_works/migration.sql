-- Коэффициент стоимости оценки и арматурные работы.
--
-- Базовый расчёт по прайсу остаётся как был и всегда виден, поэтому к нему
-- добавляются отдельные поля, а не переписывается `suggested_minor`:
-- «база 4 000 × 1.20 = 4 800» нужно уметь показать и спустя полгода.
--
-- Арматурные работы живут в тех же позициях оценки, что и PDR-ремонт:
-- второй механизм расчёта не появляется, а итог складывается из обоих видов.

ALTER TABLE "assessments"
    ADD COLUMN "base_minor" BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN "price_coefficient" INTEGER NOT NULL DEFAULT 100,
    ADD COLUMN "extras_minor" BIGINT NOT NULL DEFAULT 0;

-- У сделанных ранее оценок база — это и есть предложенный расчёт:
-- коэффициента тогда не было, и 100 % его не меняет.
UPDATE "assessments" SET "base_minor" = "suggested_minor";

-- Границы коэффициента: −50 %…+100 % шагом 5 %. Проверка в базе, потому что
-- итог оценки уходит в обращение и в смету, а «×10» там был бы катастрофой.
ALTER TABLE "assessments"
    ADD CONSTRAINT "assessments_price_coefficient_range"
    CHECK (
        "price_coefficient" >= 50
        AND "price_coefficient" <= 200
        AND "price_coefficient" % 5 = 0
    );

ALTER TABLE "assessment_items"
    ADD COLUMN "kind" "estimate_item_kind" NOT NULL DEFAULT 'damage',
    ADD COLUMN "title" TEXT;

-- У арматурной работы обязательно название: PDR-строка подписывается деталью
-- и размером, а работа без названия в печатном документе — пустая строка.
ALTER TABLE "assessment_items"
    ADD CONSTRAINT "assessment_items_extra_named"
    CHECK ("kind" = 'damage' OR "title" IS NOT NULL);
