-- CreateEnum
CREATE TYPE "VideoSessionRevokeReason" AS ENUM ('access_ended', 'superseded', 'lesson_closed', 'manual');

-- AlterTable
ALTER TABLE "video_assets" ADD COLUMN     "size_bytes" BIGINT;

-- CreateTable
CREATE TABLE "video_view_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "enrollment_id" UUID NOT NULL,
    "lesson_key" TEXT NOT NULL,
    "video_asset_id" UUID NOT NULL,
    "watermark" TEXT NOT NULL,
    "drm" BOOLEAN NOT NULL DEFAULT false,
    "capabilities" JSONB,
    "issued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "revoke_reason" "VideoSessionRevokeReason",
    "check_count" INTEGER NOT NULL DEFAULT 0,
    "last_check_at" TIMESTAMPTZ(6),
    "ip" TEXT,
    "user_agent" TEXT,

    CONSTRAINT "video_view_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "video_view_sessions_user_id_revoked_at_idx" ON "video_view_sessions"("user_id", "revoked_at");

-- CreateIndex
CREATE INDEX "video_view_sessions_enrollment_id_lesson_key_idx" ON "video_view_sessions"("enrollment_id", "lesson_key");

-- CreateIndex
CREATE INDEX "video_view_sessions_expires_at_idx" ON "video_view_sessions"("expires_at");

-- AddForeignKey
ALTER TABLE "video_view_sessions" ADD CONSTRAINT "video_view_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_view_sessions" ADD CONSTRAINT "video_view_sessions_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_view_sessions" ADD CONSTRAINT "video_view_sessions_video_asset_id_fkey" FOREIGN KEY ("video_asset_id") REFERENCES "video_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Одна действующая сессия просмотра на ученика и урок: открытие урока на
-- втором устройстве закрывает первый плеер, а не плодит живые токены.
CREATE UNIQUE INDEX "video_session_single_active"
    ON "video_view_sessions" ("enrollment_id", "lesson_key")
    WHERE "revoked_at" IS NULL;
