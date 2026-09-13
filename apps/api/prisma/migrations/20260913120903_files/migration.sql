-- CreateEnum
CREATE TYPE "file_scope" AS ENUM ('order_photo', 'submission', 'exam_attempt', 'lesson_material', 'avatar', 'export', 'course_cover', 'question_image');

-- CreateEnum
CREATE TYPE "file_status" AS ENUM ('pending', 'uploaded', 'processing', 'ready', 'failed', 'deleted');

-- CreateTable
CREATE TABLE "files" (
    "id" UUID NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "workspace_id" UUID,
    "scope" "file_scope" NOT NULL,
    "storage_key" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "original_name" TEXT,
    "status" "file_status" NOT NULL DEFAULT 'pending',
    "width" INTEGER,
    "height" INTEGER,
    "duration_sec" INTEGER,
    "variants" JSONB NOT NULL DEFAULT '{}',
    "checksum_sha256" TEXT,
    "upload_id" TEXT,
    "error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "files_storage_key_key" ON "files"("storage_key");

-- CreateIndex
CREATE INDEX "files_workspace_id_scope_idx" ON "files"("workspace_id", "scope");

-- CreateIndex
CREATE INDEX "files_owner_user_id_scope_idx" ON "files"("owner_user_id", "scope");

-- CreateIndex
CREATE INDEX "files_status_created_at_idx" ON "files"("status", "created_at");

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
