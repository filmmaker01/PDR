-- Источник клиента у заказа и канал MAX.
--
-- Мастер почти всегда начинает сразу с заказа, без обращения, поэтому
-- источник («откуда пришёл клиент») нужен и у заказа. Справочник тот же,
-- что у обращения; при конвертации обращения в заказ источник переносится.

ALTER TYPE "lead_channel" ADD VALUE IF NOT EXISTS 'max' BEFORE 'vk';

ALTER TABLE "orders"
    ADD COLUMN "source" "lead_source",
    ADD COLUMN "channel" "lead_channel";
