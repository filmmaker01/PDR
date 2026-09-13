-- CreateEnum
CREATE TYPE "club_status" AS ENUM ('none', 'join_requested', 'approved', 'member', 'left', 'removed', 'declined');

-- CreateTable
CREATE TABLE "club_memberships" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "access_grant_id" UUID,
    "chat_id" TEXT NOT NULL,
    "telegram_status" "club_status" NOT NULL DEFAULT 'none',
    "join_request_at" TIMESTAMPTZ(6),
    "joined_at" TIMESTAMPTZ(6),
    "removed_at" TIMESTAMPTZ(6),
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "club_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "club_events" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "event" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "club_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "club_memberships_user_id_key" ON "club_memberships"("user_id");

-- CreateIndex
CREATE INDEX "club_memberships_telegram_status_idx" ON "club_memberships"("telegram_status");

-- CreateIndex
CREATE INDEX "club_events_user_id_created_at_idx" ON "club_events"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "club_events_event_created_at_idx" ON "club_events"("event", "created_at");

-- AddForeignKey
ALTER TABLE "club_memberships" ADD CONSTRAINT "club_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_memberships" ADD CONSTRAINT "club_memberships_access_grant_id_fkey" FOREIGN KEY ("access_grant_id") REFERENCES "access_grants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_events" ADD CONSTRAINT "club_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
