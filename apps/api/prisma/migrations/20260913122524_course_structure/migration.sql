-- CreateEnum
CREATE TYPE "course_version_status" AS ENUM ('draft', 'published', 'archived');

-- CreateEnum
CREATE TYPE "material_kind" AS ENUM ('file', 'link', 'text');

-- CreateEnum
CREATE TYPE "video_status" AS ENUM ('uploading', 'processing', 'ready', 'failed');

-- CreateEnum
CREATE TYPE "exam_kind" AS ENUM ('test', 'practical');

-- CreateEnum
CREATE TYPE "question_kind" AS ENUM ('single', 'multiple', 'boolean', 'short_text');

-- CreateTable
CREATE TABLE "courses" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "courses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_versions" (
    "id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "version_no" INTEGER NOT NULL,
    "status" "course_version_status" NOT NULL DEFAULT 'draft',
    "changelog" TEXT,
    "published_at" TIMESTAMPTZ(6),
    "published_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "course_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stages" (
    "id" UUID NOT NULL,
    "course_version_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "cover_file_id" UUID,
    "unlock_days_offset" INTEGER NOT NULL DEFAULT 0,
    "requires_previous_stage" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lessons" (
    "id" UUID NOT NULL,
    "stage_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "is_required" BOOLEAN NOT NULL DEFAULT true,
    "video_asset_id" UUID,
    "min_watch_percent" INTEGER NOT NULL DEFAULT 0,
    "estimated_minutes" INTEGER,

    CONSTRAINT "lessons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lesson_materials" (
    "id" UUID NOT NULL,
    "lesson_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" "material_kind" NOT NULL,
    "title" TEXT NOT NULL,
    "file_id" UUID,
    "url" TEXT,
    "body" TEXT,

    CONSTRAINT "lesson_materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_assets" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_video_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "duration_sec" INTEGER,
    "status" "video_status" NOT NULL DEFAULT 'uploading',
    "uploaded_by" UUID,
    "error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "video_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignments" (
    "id" UUID NOT NULL,
    "stage_id" UUID NOT NULL,
    "lesson_id" UUID,
    "key" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "instructions" TEXT NOT NULL,
    "is_required" BOOLEAN NOT NULL DEFAULT true,
    "required_media" JSONB NOT NULL DEFAULT '{"min_photos":1,"min_videos":0,"text_required":false}',
    "max_video_sec" INTEGER,

    CONSTRAINT "assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exams" (
    "id" UUID NOT NULL,
    "stage_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "kind" "exam_kind" NOT NULL,
    "description" TEXT,
    "passing_score" INTEGER NOT NULL,
    "max_attempts" INTEGER,
    "time_limit_sec" INTEGER,
    "cooldown_hours" INTEGER NOT NULL DEFAULT 0,
    "shuffle_questions" BOOLEAN NOT NULL DEFAULT true,
    "questions_per_attempt" INTEGER,
    "show_explanations" BOOLEAN NOT NULL DEFAULT true,
    "is_required" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "exams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "questions" (
    "id" UUID NOT NULL,
    "exam_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" "question_kind" NOT NULL,
    "body" TEXT NOT NULL,
    "image_file_id" UUID,
    "explanation" TEXT,
    "points" INTEGER NOT NULL DEFAULT 1,
    "accepted_answers" JSONB,

    CONSTRAINT "questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_options" (
    "id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "is_correct" BOOLEAN NOT NULL,

    CONSTRAINT "question_options_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "courses_slug_key" ON "courses"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "course_versions_course_id_version_no_key" ON "course_versions"("course_id", "version_no");

-- CreateIndex
CREATE UNIQUE INDEX "stages_course_version_id_key_key" ON "stages"("course_version_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "stages_course_version_id_position_key" ON "stages"("course_version_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "lessons_stage_id_key_key" ON "lessons"("stage_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "lessons_stage_id_position_key" ON "lessons"("stage_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "lesson_materials_lesson_id_position_key" ON "lesson_materials"("lesson_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "video_assets_provider_provider_video_id_key" ON "video_assets"("provider", "provider_video_id");

-- CreateIndex
CREATE UNIQUE INDEX "assignments_stage_id_key_key" ON "assignments"("stage_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "exams_stage_id_key_key" ON "exams"("stage_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "questions_exam_id_position_key" ON "questions"("exam_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "question_options_question_id_position_key" ON "question_options"("question_id", "position");

-- AddForeignKey
ALTER TABLE "course_versions" ADD CONSTRAINT "course_versions_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_versions" ADD CONSTRAINT "course_versions_published_by_fkey" FOREIGN KEY ("published_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stages" ADD CONSTRAINT "stages_course_version_id_fkey" FOREIGN KEY ("course_version_id") REFERENCES "course_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stages" ADD CONSTRAINT "stages_cover_file_id_fkey" FOREIGN KEY ("cover_file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "stages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_video_asset_id_fkey" FOREIGN KEY ("video_asset_id") REFERENCES "video_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_materials" ADD CONSTRAINT "lesson_materials_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_materials" ADD CONSTRAINT "lesson_materials_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_assets" ADD CONSTRAINT "video_assets_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "stages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exams" ADD CONSTRAINT "exams_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "stages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "exams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_image_file_id_fkey" FOREIGN KEY ("image_file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_options" ADD CONSTRAINT "question_options_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
