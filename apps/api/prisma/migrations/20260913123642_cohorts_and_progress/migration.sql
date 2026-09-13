-- CreateEnum
CREATE TYPE "unlock_mode" AS ENUM ('interval', 'dates');

-- CreateEnum
CREATE TYPE "enrollment_status" AS ENUM ('active', 'completed', 'paused', 'withdrawn');

-- CreateEnum
CREATE TYPE "override_action" AS ENUM ('unlock', 'lock');

-- CreateTable
CREATE TABLE "cohorts" (
    "id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "course_version_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "unlock_mode" "unlock_mode" NOT NULL DEFAULT 'interval',
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "stage_dates" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "cohorts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cohort_curators" (
    "cohort_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cohort_curators_pkey" PRIMARY KEY ("cohort_id","user_id")
);

-- CreateTable
CREATE TABLE "enrollments" (
    "id" UUID NOT NULL,
    "cohort_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "access_grant_id" UUID NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "status" "enrollment_status" NOT NULL DEFAULT 'active',
    "completed_at" TIMESTAMPTZ(6),
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lesson_progress" (
    "id" UUID NOT NULL,
    "enrollment_id" UUID NOT NULL,
    "lesson_key" TEXT NOT NULL,
    "watch_position_sec" INTEGER NOT NULL DEFAULT 0,
    "watch_percent" INTEGER NOT NULL DEFAULT 0,
    "completed_at" TIMESTAMPTZ(6),
    "first_opened_at" TIMESTAMPTZ(6),
    "last_opened_at" TIMESTAMPTZ(6),

    CONSTRAINT "lesson_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stage_overrides" (
    "id" UUID NOT NULL,
    "enrollment_id" UUID NOT NULL,
    "stage_key" TEXT NOT NULL,
    "action" "override_action" NOT NULL,
    "reason" TEXT NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6),

    CONSTRAINT "stage_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stage_completions" (
    "enrollment_id" UUID NOT NULL,
    "stage_key" TEXT NOT NULL,
    "completed_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "stage_completions_pkey" PRIMARY KEY ("enrollment_id","stage_key")
);

-- CreateIndex
CREATE INDEX "cohorts_course_id_idx" ON "cohorts"("course_id");

-- CreateIndex
CREATE INDEX "cohort_curators_user_id_idx" ON "cohort_curators"("user_id");

-- CreateIndex
CREATE INDEX "enrollments_user_id_idx" ON "enrollments"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "enrollments_cohort_id_user_id_key" ON "enrollments"("cohort_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "lesson_progress_enrollment_id_lesson_key_key" ON "lesson_progress"("enrollment_id", "lesson_key");

-- CreateIndex
CREATE INDEX "stage_overrides_enrollment_id_stage_key_idx" ON "stage_overrides"("enrollment_id", "stage_key");

-- AddForeignKey
ALTER TABLE "cohorts" ADD CONSTRAINT "cohorts_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cohorts" ADD CONSTRAINT "cohorts_course_version_id_fkey" FOREIGN KEY ("course_version_id") REFERENCES "course_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cohort_curators" ADD CONSTRAINT "cohort_curators_cohort_id_fkey" FOREIGN KEY ("cohort_id") REFERENCES "cohorts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cohort_curators" ADD CONSTRAINT "cohort_curators_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_cohort_id_fkey" FOREIGN KEY ("cohort_id") REFERENCES "cohorts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_progress" ADD CONSTRAINT "lesson_progress_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stage_overrides" ADD CONSTRAINT "stage_overrides_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stage_overrides" ADD CONSTRAINT "stage_overrides_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stage_completions" ADD CONSTRAINT "stage_completions_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
