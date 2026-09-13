-- Сумма записи всегда положительна: направление задаёт вид записи.
ALTER TABLE "payment_entries"
  ADD CONSTRAINT "payment_amount_positive" CHECK ("amount_minor" > 0);

-- Возврат и корректировка ссылаются на исправляемую запись, обычная оплата — нет.
ALTER TABLE "payment_entries"
  ADD CONSTRAINT "payment_correction_target" CHECK (
    "kind" = 'payment' OR "corrects_entry_id" IS NULL OR "corrects_entry_id" <> "id"
  );
