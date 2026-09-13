-- На одно задание одновременно может быть только одна работа на проверке:
-- иначе куратор увидит две версии одной работы и не поймёт, какую смотреть.
CREATE UNIQUE INDEX "submission_single_active"
  ON "submissions" ("enrollment_id", "assignment_key")
  WHERE "status" IN ('draft', 'submitted', 'in_review');
