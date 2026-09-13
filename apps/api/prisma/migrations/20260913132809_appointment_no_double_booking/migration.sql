-- Записи не могут пересекаться у одного исполнителя.
-- Проверка на уровне базы: параллельные запросы не создадут двойное бронирование,
-- даже если оба прошли проверку в приложении.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "appointments"
  ADD CONSTRAINT "appointment_time_range" CHECK ("ends_at" > "starts_at");

ALTER TABLE "appointments"
  ADD CONSTRAINT "appointment_no_double_booking"
  EXCLUDE USING gist (
    "workspace_id" WITH =,
    "assignee_member_id" WITH =,
    tstzrange("starts_at", "ends_at", '[)') WITH &&
  )
  WHERE (
    "status" IN ('planned', 'confirmed')
    AND "allow_overlap" = false
    AND "assignee_member_id" IS NOT NULL
  );
