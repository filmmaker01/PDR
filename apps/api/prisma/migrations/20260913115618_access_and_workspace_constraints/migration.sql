-- Инварианты, которые Prisma не выражает: проверяются самой базой,
-- чтобы ошибка в коде не смогла их обойти.

-- У мастерской ровно один активный владелец.
CREATE UNIQUE INDEX "workspace_single_active_owner"
  ON "workspace_members" ("workspace_id")
  WHERE "role" = 'owner' AND "is_active" = true;

-- Субъект доступа согласован с типом: пользователь либо мастерская, не оба.
ALTER TABLE "access_grants"
  ADD CONSTRAINT "access_grants_subject_consistent" CHECK (
    ("subject_type" = 'user' AND "user_id" IS NOT NULL AND "workspace_id" IS NULL)
    OR ("subject_type" = 'workspace' AND "workspace_id" IS NOT NULL AND "user_id" IS NULL)
  );

-- Доступ к курсу всегда указывает курс.
ALTER TABLE "access_grants"
  ADD CONSTRAINT "access_grants_course_required" CHECK (
    "product" <> 'course' OR "course_id" IS NOT NULL
  );

-- Срок действия не может заканчиваться раньше начала.
ALTER TABLE "access_grants"
  ADD CONSTRAINT "access_grants_valid_range" CHECK (
    "valid_until" IS NULL OR "valid_until" > "valid_from"
  );

-- Доступ к CRM выдаётся мастерской, к клубу — пользователю.
ALTER TABLE "access_grants"
  ADD CONSTRAINT "access_grants_product_subject" CHECK (
    ("product" = 'crm' AND "subject_type" = 'workspace')
    OR ("product" IN ('course', 'club') AND "subject_type" = 'user')
  );

-- Часовой пояс и валюта заполнены осмысленно.
ALTER TABLE "workspaces"
  ADD CONSTRAINT "workspaces_timezone_not_empty" CHECK (length("timezone") > 0);
