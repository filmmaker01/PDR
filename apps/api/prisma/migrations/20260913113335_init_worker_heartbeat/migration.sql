-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "btree_gist";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateTable
CREATE TABLE "worker_heartbeats" (
    "worker_id" TEXT NOT NULL,
    "last_beat_at" TIMESTAMPTZ(6) NOT NULL,
    "version" TEXT,

    CONSTRAINT "worker_heartbeats_pkey" PRIMARY KEY ("worker_id")
);
