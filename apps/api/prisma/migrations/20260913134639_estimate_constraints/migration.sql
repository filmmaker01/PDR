-- Ровно одна согласованная смета на заказ: согласование новой версии
-- обязано снять согласование с предыдущей в той же транзакции.
CREATE UNIQUE INDEX "estimate_single_agreed"
  ON "estimates" ("order_id")
  WHERE "status" = 'agreed';

-- Скидка: проценты в диапазоне 0–100, фиксированная сумма неотрицательна.
ALTER TABLE "estimates"
  ADD CONSTRAINT "estimate_discount_value_range" CHECK (
    "discount_value" >= 0
    AND ("discount_kind" <> 'percent' OR "discount_value" <= 100)
    AND ("discount_kind" <> 'none' OR "discount_value" = 0)
  );

ALTER TABLE "estimates"
  ADD CONSTRAINT "estimate_totals_nonnegative" CHECK (
    "subtotal_minor" >= 0 AND "discount_minor" >= 0 AND "total_minor" >= 0
    AND "discount_minor" <= "subtotal_minor"
  );

ALTER TABLE "estimate_items"
  ADD CONSTRAINT "estimate_item_quantity_positive" CHECK ("quantity" > 0);

ALTER TABLE "price_list_items"
  ADD CONSTRAINT "price_item_price_nonnegative" CHECK ("unit_price_minor" >= 0);
