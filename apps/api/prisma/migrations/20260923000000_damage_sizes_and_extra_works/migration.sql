-- Фактический размер повреждения и арматурные работы у самого повреждения.
--
-- Тарифная зона и измеренный размер — разные вещи. Зона нужна калькулятору,
-- размер — человеку: повреждение 300×300 см показывалось как «100×100», и
-- мастер видел в документе чужое число вместо своего. Позиция сметы теперь
-- помнит габариты, как их помнят повреждение и позиция оценки.

ALTER TABLE "estimate_items"
    ADD COLUMN "width_mm" INTEGER,
    ADD COLUMN "height_mm" INTEGER;

ALTER TABLE "estimate_items"
    ADD CONSTRAINT "estimate_items_positive_size"
    CHECK (
        ("width_mm" IS NULL OR "width_mm" > 0)
        AND ("height_mm" IS NULL OR "height_mm" > 0)
    );

-- Арматурные работы мастер добавляет там же, где описывает повреждение, —
-- до всякой оценки. Поэтому работа принадлежит повреждению: иначе её негде
-- держать между «отметил деталь» и «сделал оценку», а итог по детали
-- («ремонт + разбор двери») не собрать ни в карточке, ни в документе.
CREATE TABLE "damage_extra_works" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "damage_id" UUID NOT NULL,
    "price_list_item_id" UUID,
    "title" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unit_price_minor" BIGINT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "damage_extra_works_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "damage_extra_works_damage_id_position_idx"
    ON "damage_extra_works"("damage_id", "position");

ALTER TABLE "damage_extra_works"
    ADD CONSTRAINT "damage_extra_works_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Повреждение снято со схемы — его работы уходят вместе с ним: отдельно они
-- не значат ничего.
ALTER TABLE "damage_extra_works"
    ADD CONSTRAINT "damage_extra_works_workspace_id_damage_id_fkey"
    FOREIGN KEY ("workspace_id", "damage_id") REFERENCES "damages"("workspace_id", "id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Позиция справочника, попавшая в работу, скрывается, а не удаляется.
ALTER TABLE "damage_extra_works"
    ADD CONSTRAINT "damage_extra_works_workspace_id_price_list_item_id_fkey"
    FOREIGN KEY ("workspace_id", "price_list_item_id") REFERENCES "price_list_items"("workspace_id", "id")
    ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "damage_extra_works"
    ADD CONSTRAINT "damage_extra_works_sane"
    CHECK ("quantity" >= 1 AND "unit_price_minor" >= 0);
