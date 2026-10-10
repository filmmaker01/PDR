-- Размерная сетка мастерской: «до 40×60 см → цена».
--
-- Сетка — это те же позиции прайса для повреждений, только с границами
-- размера. Поэтому оценка, смета и документы ссылаются на строку сетки так
-- же, как на любую позицию прайса, а мастер правит цены и границы без
-- изменения кода. Обе границы пустые — строка «крупнее остальных».

ALTER TABLE "price_list_items"
    ADD COLUMN "size_tier" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "max_width_mm" INTEGER,
    ADD COLUMN "max_height_mm" INTEGER;

ALTER TABLE "price_list_items"
    ADD CONSTRAINT "price_list_items_size_tier_shape"
    CHECK (
        (
            "size_tier" = false
            AND "max_width_mm" IS NULL
            AND "max_height_mm" IS NULL
        )
        OR (
            "size_tier" = true
            AND "kind" = 'damage'
            AND "panel_code" IS NULL
            AND "damage_type" IS NULL
            AND "size_class" IS NULL
            AND (
                ("max_width_mm" IS NULL AND "max_height_mm" IS NULL)
                OR ("max_width_mm" > 0 AND "max_height_mm" > 0)
            )
        )
    );
