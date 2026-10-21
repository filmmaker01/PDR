-- Чек-лист состояния автомобиля при приёмке: отмеченные пункты и примечание.
-- Только добавление колонок: существующие заказы получают пустой список.
ALTER TABLE "orders" ADD COLUMN     "vehicle_condition" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "vehicle_condition_note" TEXT;
