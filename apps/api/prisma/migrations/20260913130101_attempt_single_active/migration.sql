-- Одновременно у ученика может идти только одна попытка экзамена:
-- иначе таймер и выборка вопросов теряют смысл.
CREATE UNIQUE INDEX "attempt_single_active"
  ON "exam_attempts" ("enrollment_id", "exam_key")
  WHERE "status" = 'in_progress';
